const sfxPath = (name) => `/audio/sfx/${name}`;
const numbered = (prefix, count = 5) => Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(3, '0')}.ogg`);
const MASTER_VOLUME = 0.88;

const list = (prefix, ids) => ids.map((i) => `${prefix}${i}.ogg`);
const SOUND_BANK = {
  stepGrass: numbered('footstep_grass_'),
  stepRock: numbered('footstep_concrete_'),
  stepSand: numbered('footstep_snow_'),
  stepSnow: numbered('footstep_snow_'),
  // взмахи: оружием — свист клинка, кулаком и броском — шорох ткани
  swing: ['knifeSlice.ogg', 'knifeSlice2.ogg'],
  swingFist: list('cloth', [1, 2, 3, 4]),
  equip: list('drawKnife', [1, 2, 3]),
  hit: numbered('impactPunch_medium_'),
  heavyHit: numbered('impactPunch_heavy_'),
  metalHit: numbered('impactMetal_'),
  danger: numbered('impactBell_heavy_'),
  alarm: ['highDown.ogg', 'lowRandom.ogg', 'twoTone1.ogg'], // машина заметила цель и замахивается
  woodHit: numbered('impactWood_medium_'),
  chop: ['chop.ogg', ...numbered('impactWood_medium_', 3)],
  woodBreak: numbered('impactWood_heavy_'),
  creak: list('creak', [1, 2, 3]),
  stoneHit: numbered('impactMining_'),
  softHit: numbered('impactSoft_medium_'),
  softBreak: numbered('impactSoft_heavy_'),
  crystalHit: numbered('impactBell_heavy_'),
  pickup: ['pluck_001.ogg', 'pluck_002.ogg', ...numbered('impactGeneric_light_')],
  loot: ['handleSmallLeather.ogg', 'handleSmallLeather2.ogg', 'dropLeather.ogg', 'handleCoins.ogg', 'handleCoins2.ogg'],
  craft: ['metalPot1.ogg', 'metalPot2.ogg', 'metalPot3.ogg', 'metalClick.ogg'],
  place: list('bookPlace', [1, 2, 3]),
  latch: ['metalLatch.ogg', 'metalClick.ogg'],
  doorOpen: ['doorOpen_1.ogg', 'doorOpen_2.ogg'],
  doorClose: ['doorClose_1.ogg', 'doorClose_2.ogg'],
  bookOpen: ['bookOpen.ogg'],
  bookClose: ['bookClose.ogg'],
  bookFlip: list('bookFlip', [1, 2, 3]),
  uiClick: ['click_001.ogg', 'click_002.ogg', 'click_003.ogg', 'click_004.ogg'],
  uiOpen: ['open_001.ogg', 'open_002.ogg'],
  uiClose: ['close_001.ogg', 'close_002.ogg'],
  uiSelect: ['select_001.ogg', 'select_002.ogg', 'select_003.ogg'],
  uiConfirm: ['confirmation_001.ogg', 'confirmation_002.ogg'],
  chat: list('pepSound', [1, 2, 3]),
  notify: ['threeTone1.ogg', 'threeTone2.ogg'],
  notifyBig: ['twoTone2.ogg', 'lowThreeTone.ogg'],
  evolve: ['bong_001.ogg'],
  slime: ['slime_000.ogg'],
  bite: numbered('impactSoft_medium_'),
  drink: numbered('impactSoft_medium_'),
  // оружие и умения
  gunshot: numbered('explosionCrunch_', 4),
  blast: numbered('explosionCrunch_', 4),
  rumble: ['lowFrequency_explosion_000.ogg', 'lowFrequency_explosion_001.ogg'],
  laser: numbered('laserSmall_'),
  laserRetro: numbered('laserRetro_', 3),
  laserBig: numbered('laserLarge_', 3),
  staff: list('laser', [1, 2, 3, 4]),
  thruster: numbered('thrusterBurst_', 3),
  forceField: numbered('forceField_', 3),
  zap: ['zap1.ogg', 'zap2.ogg', 'zapTwoTone.ogg'],
  phaseJump: list('phaseJump', [1, 2, 3]),
  phaserUp: list('phaserUp', [1, 2, 3]),
  phaserDown: list('phaserDown', [1, 2, 3]),
  curse: ['zapThreeToneDown.ogg', 'lowThreeTone.ogg'],
  powerUp: list('powerUp', [1, 2, 3, 4]),
  rise: ['zapThreeToneUp.ogg', 'highUp.ogg'],
  robotDie: list('spaceTrash', [1, 2, 3]),
  playerDie: ['lowDown.ogg'],
};

// Выравнивание громкости: тихие записи поднимаем, громкие приглушаем
const GAIN = { bookFlip: 3.5, equip: 3.5, loot: 1.8, latch: 1.5, creak: 1.4, splash: 1.5, crunch: 1.7, sizzle: 1.5, powerUp: 0.6, rumble: 0.7, craft: 0.7, place: 0.7, chat: 0.7 };

// ---------- синтез: то, чего нет в записях ----------
// Каждый рецепт — слои шума и тона с огибающей; строится в момент проигрывания.
// noise: { n: 1, dur, f0, f1, type, q }  tone: { wave, f0, f1, dur, vib, am }  общие: g — громкость, at — атака, d — задержка
const rnd = (a, b) => a + Math.random() * (b - a);
const SYNTH = {
  // тетива лука и арбалета
  twang: () => [
    { wave: 'triangle', f0: rnd(190, 230), f1: 150, dur: 0.22, g: 0.7, vib: [38, 14] },
    { n: 1, type: 'bandpass', f0: 2600, f1: 700, q: 1.2, dur: 0.16, g: 0.35 },
  ],
  // рык мутанта: низкая пила с дрожью; pitch задаёт размер зверя
  growl: (pitch = 1) => [
    { wave: 'sawtooth', f0: 95 * pitch, f1: 62 * pitch, dur: 0.55, at: 0.06, g: 0.5, am: [rnd(24, 34), 0.75], lp: 620 * pitch },
    { wave: 'sawtooth', f0: 143 * pitch, f1: 88 * pitch, dur: 0.5, at: 0.08, g: 0.3, am: [rnd(17, 23), 0.8], lp: 900 * pitch },
    { n: 1, type: 'bandpass', f0: 500 * pitch, f1: 260 * pitch, q: 1.5, dur: 0.5, at: 0.05, g: 0.22 },
  ],
  // вой лесного духа
  wail: () => [
    { wave: 'sine', f0: rnd(520, 640), f1: 300, dur: 0.9, at: 0.15, g: 0.32, vib: [6, 22] },
    { wave: 'sine', f0: rnd(780, 900), f1: 430, dur: 0.8, at: 0.2, g: 0.16, vib: [5, 30] },
  ],
  // шаг по воде
  splash: () => [
    { n: 1, type: 'bandpass', f0: rnd(900, 1500), f1: 420, q: 0.8, dur: 0.24, at: 0.01, g: 0.55 },
    { n: 1, type: 'highpass', f0: 3200, f1: 5000, q: 0.5, dur: 0.13, g: 0.16, d: 0.03 },
  ],
  // глоток
  gulp: () => [
    { wave: 'sine', f0: 240, f1: 520, dur: 0.11, g: 0.5 },
    { wave: 'sine', f0: 210, f1: 470, dur: 0.12, g: 0.45, d: 0.17 },
  ],
  // хруст еды
  crunch: () => [0, 0.09, 0.2].map((d) => ({ n: 1, type: 'bandpass', f0: rnd(1500, 2800), f1: 900, q: 2, dur: 0.06, g: 0.5, d })),
  // шипение кислоты
  sizzle: () => [{ n: 1, type: 'highpass', f0: 3800, f1: 6500, q: 0.7, dur: 0.5, at: 0.02, g: 0.3, am: [31, 0.6] }],
  // щелчок счётчика Гейгера
  geiger: () => [{ n: 1, type: 'highpass', f0: 2500, f1: 2500, q: 0.5, dur: 0.012, g: 0.5 }],
  // удар сердца
  heart: () => [
    { wave: 'sine', f0: 68, f1: 42, dur: 0.16, g: 0.9 },
    { wave: 'sine', f0: 60, f1: 38, dur: 0.2, g: 0.65, d: 0.2 },
  ],
  // птица: два-три коротких свиста
  bird: () => {
    const f = rnd(2200, 3900);
    const n = 2 + Math.floor(Math.random() * 3);
    return Array.from({ length: n }, (_, i) => ({ wave: 'sine', f0: f * rnd(0.9, 1.1), f1: f * rnd(1.15, 1.5), dur: rnd(0.05, 0.11), at: 0.01, g: 0.16, d: i * rnd(0.1, 0.16) }));
  },
  // уханье в ночном лесу
  owl: () => [
    { wave: 'sine', f0: 400, f1: 350, dur: 0.28, at: 0.05, g: 0.2 },
    { wave: 'sine', f0: 390, f1: 330, dur: 0.5, at: 0.06, g: 0.22, d: 0.42 },
  ],
  // треск костра
  crackle: () => [{ n: 1, type: 'bandpass', f0: rnd(1200, 4200), f1: 1000, q: 3, dur: rnd(0.015, 0.05), g: rnd(0.2, 0.5) }],
};

// Фоновые слои: шум или тон, пропущенный через фильтр; громкость плавно идёт к нужной
const AMBIENT = {
  wind: { noise: true, type: 'bandpass', freq: 420, q: 0.5, lfo: [0.13, 180], max: 0.2 },
  waves: { noise: true, type: 'lowpass', freq: 520, q: 0.4, swell: 0.16, max: 0.2 },
  crickets: { wave: 'sine', freq: 4300, pulse: 23, max: 0.035 },
  hum: { wave: 'sawtooth', freq: 55, type: 'lowpass', filter: 170, q: 2, lfo: [0.21, 4], max: 0.11 },
  fire: { noise: true, type: 'lowpass', freq: 300, q: 0.6, lfo: [0.7, 90], max: 0.11 },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class AudioManager {
  constructor() {
    const Context = window.AudioContext || window.webkitAudioContext;
    this.context = Context ? new Context() : null;
    this.buffers = new Map();
    this.muted = false;
    try { this.muted = localStorage.getItem('mutagen.soundMuted') === '1'; } catch { /* storage may be unavailable */ }
    this.master = this.context?.createGain() || null;
    this.compressor = this.context?.createDynamicsCompressor() || null;
    if (this.master) {
      this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
      this.compressor.threshold.value = -4;
      this.compressor.knee.value = 4;
      this.compressor.ratio.value = 12;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.18;
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
    }
    this.ready = this.load();

    // браузер разрешает звук только после действия игрока; пробуем на каждом нажатии, пока не заработает
    const unlock = () => {
      if (!this.context || this.context.state === 'running') {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
        return;
      }
      this.context.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('click', (event) => {
      const control = event.target?.closest?.('button, .ed-school, .cr-tab, .bm-tab, .bm-tool, .cr-card, .bm-card, .pw-go');
      if (!control || control.disabled) return;
      const sound = control.matches('.ed-school, .cr-tab, .bm-tab, .pw-go') ? 'bookFlip' : control.matches('.cr-card, .bm-card, .bm-tool') ? 'uiSelect'
        : control.classList.contains('primary') ? 'uiConfirm' : 'uiClick';
      this.play(sound, { volume: 0.24 });
    }, true);
  }

  async load() {
    if (!this.context) return;
    const files = new Set(Object.values(SOUND_BANK).flat());
    await Promise.all([...files].map(async (file) => {
      try {
        const response = await fetch(sfxPath(file));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        this.buffers.set(file, await this.context.decodeAudioData(data));
      } catch (error) {
        console.warn(`Не удалось загрузить звук ${file}:`, error);
      }
    }));
  }

  play(name, { volume = 1, rate = 1, pan = 0, arg } = {}) {
    if (!this.context || !this.master || this.muted || this.context.state !== 'running') return false;
    volume *= GAIN[name] || 1;
    if (SYNTH[name]) return this.synth(name, { volume, pan, arg });
    const variants = SOUND_BANK[name];
    if (!variants?.length) return false;
    const file = variants[Math.floor(Math.random() * variants.length)];
    const buffer = this.buffers.get(file);
    if (!buffer) return false;

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const stereo = this.context.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    gain.gain.value = clamp(volume, 0, 2);
    stereo.pan.value = clamp(pan, -1, 1);
    source.connect(gain);
    gain.connect(stereo);
    stereo.connect(this.master);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      stereo.disconnect();
    };
    source.start();
    return true;
  }

  // общий шум для синтеза
  noiseBuffer() {
    if (!this.noise) {
      const len = this.context.sampleRate * 2;
      this.noise = this.context.createBuffer(1, len, this.context.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  // синтезированный звук по рецепту из SYNTH; arg — параметр рецепта (например, высота рыка)
  synth(name, { volume = 1, pan = 0, arg } = {}) {
    if (!this.context || !this.master || this.muted || this.context.state !== 'running') return false;
    const recipe = SYNTH[name];
    if (!recipe) return false;
    const ctx = this.context;
    const out = ctx.createGain();
    const stereo = ctx.createStereoPanner();
    out.gain.value = clamp(volume, 0, 2);
    stereo.pan.value = clamp(pan, -1, 1);
    out.connect(stereo);
    stereo.connect(this.master);
    const t0 = ctx.currentTime + 0.005;
    let end = 0;
    for (const L of recipe(arg)) {
      const t = t0 + (L.d || 0);
      const at = L.at || 0.004;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(L.g, t + at);
      env.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(L.dur, at + 0.01));
      let src;
      let node;
      if (L.n) {
        src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer();
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = L.type;
        f.Q.value = L.q || 1;
        f.frequency.setValueAtTime(L.f0, t);
        f.frequency.exponentialRampToValueAtTime(L.f1, t + L.dur);
        src.connect(f);
        node = f;
        src.start(t, Math.random() * 1.5);
      } else {
        src = ctx.createOscillator();
        src.type = L.wave;
        src.frequency.setValueAtTime(L.f0, t);
        src.frequency.exponentialRampToValueAtTime(L.f1, t + L.dur);
        if (L.vib) {
          const lfo = ctx.createOscillator();
          const depth = ctx.createGain();
          lfo.frequency.value = L.vib[0];
          depth.gain.value = L.vib[1];
          lfo.connect(depth);
          depth.connect(src.frequency);
          lfo.start(t);
          lfo.stop(t + L.dur + 0.05);
        }
        node = src;
        if (L.lp) {
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = L.lp;
          src.connect(f);
          node = f;
        }
        src.start(t);
      }
      if (L.am) {
        // дрожь громкости: рык, шипение
        const trem = ctx.createGain();
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        trem.gain.value = 1 - L.am[1] / 2;
        lfo.frequency.value = L.am[0];
        depth.gain.value = L.am[1] / 2;
        lfo.connect(depth);
        depth.connect(trem.gain);
        lfo.start(t);
        lfo.stop(t + L.dur + 0.05);
        node.connect(trem);
        node = trem;
      }
      node.connect(env);
      env.connect(out);
      src.stop(t + L.dur + 0.05);
      end = Math.max(end, (L.d || 0) + L.dur);
    }
    setTimeout(() => {
      out.disconnect();
      stereo.disconnect();
    }, (end + 0.3) * 1000);
    return true;
  }

  // ---------- фон: ветер, прибой, сверчки, гул города, костёр, птицы, счётчик Гейгера, сердце ----------
  startAmbient() {
    const ctx = this.context;
    this.amb = {};
    for (const [id, A] of Object.entries(AMBIENT)) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let src;
      let node;
      if (A.noise) {
        src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer();
        src.loop = true;
      } else {
        src = ctx.createOscillator();
        src.type = A.wave;
        src.frequency.value = A.freq;
      }
      node = src;
      let filter = null;
      if (A.type) {
        filter = ctx.createBiquadFilter();
        filter.type = A.type;
        filter.frequency.value = A.noise ? A.freq : A.filter;
        filter.Q.value = A.q || 1;
        src.connect(filter);
        node = filter;
      }
      const lfoTo = (param, rate, depth) => {
        const lfo = ctx.createOscillator();
        const d = ctx.createGain();
        lfo.frequency.value = rate;
        d.gain.value = depth;
        lfo.connect(d);
        d.connect(param);
        lfo.start();
      };
      if (A.lfo) lfoTo(filter ? filter.frequency : src.frequency, A.lfo[0], A.lfo[1]);
      if (A.swell || A.pulse) {
        // прибой накатывает, сверчки стрекочут — громкость качается
        const mod = ctx.createGain();
        mod.gain.value = 0.5;
        lfoTo(mod.gain, A.swell || A.pulse, 0.5);
        node.connect(mod);
        node = mod;
      }
      node.connect(gain);
      gain.connect(this.master);
      src.start();
      this.amb[id] = gain;
    }
    this.ambT = { bird: 3, geiger: 0, heart: 0, crackle: 0 };
  }

  // env: { tile, night (0..1), water — рядом вода, rad — сила радиации под ногами, fire — у костра, hp — доля здоровья, dead }
  ambient(dt, env) {
    if (!this.context || this.context.state !== 'running') return;
    if (!this.amb) this.startAmbient();
    const { tile, night = 0 } = env;
    const land = tile >= 2;
    const want = {
      wind: tile === 8 ? 1 : tile === 5 ? 0.75 : tile === 6 || tile === 7 ? 0.55 : land ? 0.3 : 0.5, // снег и скалы продувает
      waves: env.water ? 1 : 0,
      crickets: night > 0.5 && (tile === 3 || tile === 4 || tile === 2) ? 1 : 0,
      hum: tile === 6 || tile === 7 ? 1 : 0, // мёртвый город гудит
      fire: env.fire ? 1 : 0,
    };
    const now = this.context.currentTime;
    for (const id in want) this.amb[id].gain.setTargetAtTime(env.dead ? 0 : want[id] * AMBIENT[id].max, now, 0.8);
    if (env.dead) return;
    const T = this.ambT;
    // птицы днём в лесу и на лугу, ночью изредка ухает сова
    T.bird -= dt;
    if (T.bird <= 0) {
      const green = tile === 3 || tile === 4;
      if (green && night < 0.4) this.synth('bird', { volume: rnd(0.25, 0.6), pan: rnd(-0.9, 0.9) });
      else if (tile === 4 && night > 0.6 && Math.random() < 0.35) this.synth('owl', { volume: 0.4, pan: rnd(-0.8, 0.8) });
      T.bird = green && night < 0.4 ? rnd(1.5, 7) : rnd(6, 14);
    }
    // счётчик Гейгера трещит тем чаще, чем сильнее радиация
    if (env.rad > 0) {
      T.geiger -= dt;
      if (T.geiger <= 0) {
        this.synth('geiger', { volume: rnd(0.25, 0.5), pan: rnd(-0.3, 0.3) });
        T.geiger = -Math.log(1 - Math.random() * 0.98) / (5 + env.rad * 12);
      }
    }
    if (env.fire) {
      T.crackle -= dt;
      if (T.crackle <= 0) {
        this.synth('crackle', { volume: 0.5, pan: rnd(-0.4, 0.4) });
        T.crackle = rnd(0.03, 0.4);
      }
    }
    // сердце стучит, когда здоровья меньше четверти
    if (env.hp < 0.25) {
      T.heart -= dt;
      if (T.heart <= 0) {
        this.synth('heart', { volume: 0.5 });
        T.heart = 0.75 + env.hp * 1.6;
      }
    }
  }

  playAt(name, x, y, listenerX, listenerY, { volume = 1, range = 720, yaw = 0, rate = 1, arg } = {}) {
    const dx = x - listenerX;
    const dy = y - listenerY;
    const distance = Math.hypot(dx, dy);
    if (distance >= range) return false;
    const attenuation = Math.pow(1 - distance / range, 1.45);
    const direction = Math.atan2(dy, dx) - yaw;
    return this.play(name, {
      volume: volume * attenuation,
      rate,
      arg,
      pan: Math.sin(direction) * Math.min(1, distance / 180),
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_VOLUME, this.context.currentTime, 0.025);
    }
    try { localStorage.setItem('mutagen.soundMuted', this.muted ? '1' : '0'); } catch { /* storage may be unavailable */ }
    return this.muted;
  }
}
