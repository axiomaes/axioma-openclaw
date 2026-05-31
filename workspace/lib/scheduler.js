const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.scheduler-state.json');

function getBaseSlots(weekStart) {
  // Lunes (1), Miércoles (3), Viernes (5)
  return [1, 3, 5].map(dayOffset => {
    // Variación de ±1 día
    const variation = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
    let targetDay = dayOffset + variation;
    // Si cae en fin de semana, lo ajustamos a viernes o lunes
    if (targetDay <= 0) targetDay = 1;
    if (targetDay >= 6) targetDay = 5;
    
    // Hora aleatoria entre 08:00 y 10:30
    const hour = 8 + Math.floor(Math.random() * 3); // 8, 9, 10
    const minute = Math.floor(Math.random() * (hour === 10 ? 31 : 60)); 
    
    const slotDate = new Date(weekStart);
    slotDate.setDate(slotDate.getDate() + targetDay - slotDate.getDay());
    slotDate.setHours(hour, minute, 0, 0);
    return slotDate;
  });
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return generateNewState();
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function generateNewState() {
  const now = new Date();
  const weekStart = getWeekStart(now);
  const slots = getBaseSlots(weekStart);
  
  const state = {
    weekStart: weekStart.toISOString(),
    slots: slots.map(s => s.toISOString()),
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
    state = generateNewState();
  }

  if (state.lastPublished) {
    const lastPub = new Date(state.lastPublished);
    if (lastPub.toDateString() === now.toDateString()) {
      return false; // Ya se publicó hoy
    }
  }

  for (const slotStr of state.slots) {
    const slot = new Date(slotStr);
    const diffMin = Math.abs((now.getTime() - slot.getTime()) / 60000);
    
    // Ventana de ±15 minutos
    if (diffMin <= 15) {
      return true;
    }
  }
  
  return false;
}

function getNextScheduledSlot() {
  const state = loadState();
  const now = new Date();
  
  for (const slotStr of state.slots) {
    const slot = new Date(slotStr);
    if (slot > now) return slot;
  }
  return null;
}

function markPublished() {
  const state = loadState();
  state.lastPublished = new Date().toISOString();
  saveState(state);
}

module.exports = {
  shouldPublishNow,
  getNextScheduledSlot,
  markPublished
};
