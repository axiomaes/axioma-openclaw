const fs = require('fs');
const path = require('path');

// El estado debe persistir en /root/.openclaw/.scheduler-state.json (dentro del volumen persistente)
// Hacemos fallback local por si se ejecuta fuera de Docker
const STATE_FILE = fs.existsSync('/root/.openclaw') 
  ? '/root/.openclaw/.scheduler-state.json' 
  : path.join(__dirname, '..', '.scheduler-state.json');

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  // Lunes como inicio de semana
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      console.error("Error reading state file", e);
    }
  }
  return generateNewState();
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function generateNewState() {
  const now = new Date();
  const weekStart = getWeekStart(now);
  
  const state = {
    weekStart: weekStart.toISOString(),
    publishedCount: 0,
    lastPublished: null
  };
  saveState(state);
  return state;
}

function shouldPublishNow() {
  let state = loadState();
  const now = new Date();
  
  const currentWeekStart = getWeekStart(now);
  if (new Date(state.weekStart).getTime() !== currentWeekStart.getTime()) {
    // Es una nueva semana calendario, reseteamos el estado
    state = generateNewState();
  }

  // 1. Respeta el límite de 3 publicaciones por semana
  // 2. No publica si ya se publicaron 3 blogs esta semana
  if (state.publishedCount >= 3) {
    return false;
  }

  if (state.lastPublished) {
    const lastPub = new Date(state.lastPublished);
    
    // Comparamos días a medianoche para ver separación pura de calendario
    const lastPubDate = new Date(lastPub);
    lastPubDate.setHours(0, 0, 0, 0);
    const nowDate = new Date(now);
    nowDate.setHours(0, 0, 0, 0);
    
    const diffDays = Math.round((nowDate.getTime() - lastPubDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // 3. Deja al menos 1 día de separación entre publicaciones
    // Si diffDays == 0 (mismo día), o diffDays == 1 (día siguiente consecutivo), bloqueamos.
    // Requiere diffDays >= 2 (ej. Publica Lunes -> Martes bloqueado -> Miércoles permitido)
    if (diffDays <= 1) {
      return false;
    }
  }

  return true;
}

function markPublished() {
  const state = loadState();
  state.lastPublished = new Date().toISOString();
  state.publishedCount = (state.publishedCount || 0) + 1;
  saveState(state);
}

module.exports = {
  shouldPublishNow,
  markPublished
};
