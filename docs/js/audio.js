// Tiny WebAudio synth for Twotone. Everything is generated — no audio files.
let ctx = null, master = null, muted = false;

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

function ensure() {
  if (muted) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch (e) { return null; }
}

function tone(freq, dur, { type = 'sine', gain = 0.18, attack = 0.006, delay = 0, slide = 0, detune = 0 } = {}) {
  const c = ensure(); if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  if (detune) o.detune.value = detune;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, { gain = 0.08, freq = 1200, delay = 0 } = {}) {
  const c = ensure(); if (!c) return;
  const t = c.currentTime + delay;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const sfx = {
  setMuted(m) { muted = m; if (m && ctx && ctx.state === 'running') ctx.suspend(); if (!m && ctx) ctx.resume(); },
  isMuted() { return muted; },
  unlock() { ensure(); },
  sun(step = 0) {
    const n = 72 + PENTA[Math.min(step, PENTA.length - 1)];
    tone(midi(n), 0.22, { type: 'triangle', gain: 0.16 });
    tone(midi(n + 12), 0.12, { type: 'sine', gain: 0.05, delay: 0.01 });
  },
  moon(step = 0) {
    const n = 60 + PENTA[Math.min(step, PENTA.length - 1)];
    tone(midi(n), 0.32, { type: 'sine', gain: 0.2 });
    tone(midi(n + 7), 0.26, { type: 'sine', gain: 0.05, delay: 0.02 });
  },
  clear() { tone(330, 0.08, { type: 'triangle', gain: 0.06, slide: 0.6 }); },
  tap() { noise(0.03, { gain: 0.05, freq: 2500 }); },
  locked() { tone(160, 0.12, { type: 'square', gain: 0.035, slide: 0.8 }); },
  undo() { tone(520, 0.14, { type: 'triangle', gain: 0.08, slide: 0.55 }); },
  hint() { [76, 83, 88].forEach((n, i) => tone(midi(n), 0.4, { type: 'sine', gain: 0.09, delay: i * 0.07 })); },
  error() { tone(196, 0.22, { type: 'sawtooth', gain: 0.045, slide: 0.85 }); tone(207, 0.22, { type: 'sawtooth', gain: 0.035 }); },
  line() { [79, 84].forEach((n, i) => tone(midi(n), 0.35, { type: 'sine', gain: 0.06, delay: 0.05 + i * 0.06 })); },
  ui() { tone(880, 0.06, { type: 'sine', gain: 0.06 }); },
  count(last) { tone(last ? 880 : 587, last ? 0.4 : 0.18, { type: 'triangle', gain: 0.14 }); },
  botDone() { tone(midi(67), 0.15, { type: 'square', gain: 0.03 }); tone(midi(64), 0.2, { type: 'square', gain: 0.03, delay: 0.1 }); },
  win() {
    const seq = [60, 64, 67, 72, 76, 79, 84];
    seq.forEach((n, i) => {
      tone(midi(n), 0.5, { type: 'triangle', gain: 0.12, delay: i * 0.08 });
      tone(midi(n + 12), 0.3, { type: 'sine', gain: 0.04, delay: i * 0.08 + 0.02 });
    });
    tone(midi(48), 1.2, { type: 'sine', gain: 0.12, delay: 0.56 });
    tone(midi(84), 1.2, { type: 'sine', gain: 0.05, delay: 0.56 });
  },
};
