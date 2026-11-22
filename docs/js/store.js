// localStorage persistence (settings, stats, daily progress). Fails soft.
const KEY = 'twotone:v1';

const DEFAULTS = () => ({
  settings: { sound: true, errors: true, theme: 'auto' },
  seenHowTo: false,
  daily: {},            // dateKey -> { grid, ms, hints, done, finalMs }
  streak: { current: 0, best: 0, lastDay: null },
  dailyPlayed: 0,
  dailySolved: 0,
  dailyNoHint: 0,
  practice: {},         // diff -> { solved, best, totalMs }
  race: { played: 0, wins: 0, podiums: 0 },
});

let state = load();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return DEFAULTS();
    const d = DEFAULTS();
    return { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) }, streak: { ...d.streak, ...(raw.streak || {}) }, race: { ...d.race, ...(raw.race || {}) } };
  } catch (e) { return DEFAULTS(); }
}

export function save() {
  try {
    // keep only the last 40 daily records
    const keys = Object.keys(state.daily).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete state.daily[k];
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) { /* storage full or blocked: play on */ }
}

export function get() { return state; }

export function reset() {
  const settings = state.settings;
  state = DEFAULTS();
  state.settings = settings;
  state.seenHowTo = true;
  save();
}
