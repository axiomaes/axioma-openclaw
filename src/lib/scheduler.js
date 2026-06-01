import fs from 'fs';
import path from 'path';

// El estado debe persistir en /app/data/.scheduler-state.json
const STATE_FILE = process.env.NODE_ENV === 'production' 
  ? '/app/data/.scheduler-state.json' 
  : './.scheduler-state.json';

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  // Lunes como inicio de semana
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function generateSlot(weekStart, dayOffset) {
  const slot = new Date(weekStart);
  slot.setDate(slot.getDate() + dayOffset); // Lunes=0, Miércoles=2, Viernes=4
  slot.setHours(9, 0, 0, 0);
  const randomMinutes = Math.floor(Math.random() * 60);
  slot.setMinutes(randomMinutes);
  return slot.toISOString();
}

export function initWeekState() {
  const now = new Date();
  const weekStart = getWeekStart(now);
  const state = {
    weekStart: weekStart.toISOString(),
    platforms: {
      linkedin: {
        publishedCount: 0,
        lastPublished: null,
        nextSlot: generateSlot(weekStart, 0)
      },
      instagram: {
        publishedCount: 0,
        lastPublished: null,
        nextSlot: generateSlot(weekStart, 2)
      },
      facebook: {
        publishedCount: 0,
        lastPublished: null,
        nextSlot: generateSlot(weekStart, 4)
      }
    }
  };
  saveState(state);
  return state;
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      console.error("Error reading state file", e);
    }
  }
  return initWeekState();
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export function getPlatformsToPublish() {
  let state = loadState();
  const now = new Date();
  const currentWeekStart = getWeekStart(now);
  
  if (new Date(state.weekStart).getTime() !== currentWeekStart.getTime()) {
    state = initWeekState();
  }

  const platforms = [];
  const dayOfWeek = now.getDay();
  
  // Nunca publicar sábado(6) ni domingo(0)
  if (dayOfWeek === 0 || dayOfWeek === 6) return platforms;

  for (const plat of ['linkedin', 'instagram', 'facebook']) {
    const pState = state.platforms[plat];
    if (!pState || pState.publishedCount >= 1) continue;
    
    const slot = new Date(pState.nextSlot);
    
    // Si se pierde el slot, publicar en el próximo heartbeat disponible ese mismo día
    if (now.getTime() >= slot.getTime() && 
        now.getDate() === slot.getDate() && 
        now.getMonth() === slot.getMonth() && 
        now.getFullYear() === slot.getFullYear()) {
      platforms.push(plat);
    }
  }

  return platforms;
}

export function markPlatformPublished(platform) {
  const state = loadState();
  if (state.platforms && state.platforms[platform]) {
    state.platforms[platform].publishedCount += 1;
    state.platforms[platform].lastPublished = new Date().toISOString();
    saveState(state);
  }
}
