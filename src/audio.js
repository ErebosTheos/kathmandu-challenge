export function createAudio() {
  let context;
  let master;
  let engine;
  let hum;
  let muted = false;
  let nextHorn = 0;
  function oscillator(type, frequency, gain, output) {
    const osc = context.createOscillator();
    const level = context.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    level.gain.value = gain;
    osc.connect(level).connect(output);
    return { osc, level };
  }
  function start() {
    if (!context) {
      const Audio = window.AudioContext ?? window.webkitAudioContext;
      if (!Audio) return;
      context = new Audio();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.45;
      master.connect(context.destination);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 130;
      filter.connect(master);
      engine = oscillator('triangle', 39, 0, filter);
      hum = oscillator('sawtooth', 54, 0, filter);
      engine.osc.start();
      hum.osc.start();
      nextHorn = context.currentTime + 4;
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
  }
  function setSound(tone, frequency, length, volume) {
    if (!context || muted) return;
    const { osc, level } = oscillator(tone, frequency, 0, master);
    const now = context.currentTime;
    level.gain.setValueAtTime(0.0001, now);
    level.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.045, length * 0.2));
    level.gain.exponentialRampToValueAtTime(0.0001, now + length);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.87, now + length);
    osc.onended = () => { osc.disconnect(); level.disconnect(); };
    osc.start(now);
    osc.stop(now + length);
  }
  return {
    start,
    click() { setSound('sine', 640, 0.07, 0.07); },
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.45, context.currentTime, 0.06);
    },
    traffic(vehicles, queued, active) {
      if (!engine) return;
      const now = context.currentTime;
      const activity = Math.min(1, vehicles / 180);
      const congestion = Math.min(1, queued / 100);
      engine.level.gain.setTargetAtTime(active ? 0.019 + 0.063 * activity : 0, now, 0.24);
      engine.osc.frequency.setTargetAtTime(36 + 16 * activity - 11 * congestion, now, 0.35);
      hum.level.gain.setTargetAtTime(active ? 0.028 * activity : 0, now, 0.24);
      if (now >= nextHorn && active) {
        if (Math.random() < 0.12 + congestion * 0.8) {
          const pitch = 238 + Math.random() * 105;
          setSound('triangle', pitch, 0.27, 0.042);
          setSound('sine', pitch * 1.49, 0.22, 0.019);
        }
        nextHorn = now + 3 + Math.random() * 4 - congestion * 2;
      }
    },
  };
}
