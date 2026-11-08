const sfxPath = (name) => `/audio/sfx/${name}`;
const numbered = (prefix, count = 5) => Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(3, '0')}.ogg`);
const MASTER_VOLUME = 0.88;

const SOUND_BANK = {
  stepGrass: numbered('footstep_grass_'),
  stepRock: numbered('footstep_concrete_'),
  stepSand: numbered('footstep_snow_'),
  swing: ['knifeSlice.ogg', 'knifeSlice2.ogg'],
  hit: numbered('impactPunch_medium_'),
  heavyHit: numbered('impactPunch_heavy_'),
  danger: numbered('impactBell_heavy_'),
  woodHit: numbered('impactWood_medium_'),
  woodBreak: numbered('impactWood_heavy_'),
  stoneHit: numbered('impactMining_'),
  softHit: numbered('impactSoft_medium_'),
  softBreak: numbered('impactSoft_heavy_'),
  crystalHit: numbered('impactBell_heavy_'),
  pickup: ['pluck_001.ogg', 'pluck_002.ogg', ...numbered('impactGeneric_light_')],
  uiClick: ['click_001.ogg', 'click_002.ogg', 'click_003.ogg', 'click_004.ogg'],
  uiOpen: ['open_001.ogg', 'open_002.ogg'],
  uiClose: ['close_001.ogg', 'close_002.ogg'],
  uiSelect: ['select_001.ogg', 'select_002.ogg', 'select_003.ogg'],
  uiConfirm: ['confirmation_001.ogg', 'confirmation_002.ogg'],
  evolve: ['bong_001.ogg'],
  bite: numbered('impactSoft_medium_'),
  drink: numbered('impactSoft_medium_'),
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
      const control = event.target?.closest?.('button, .bslot, .mouth');
      if (!control || control.disabled) return;
      const sound = control.matches('.bslot, .mouth') ? 'uiSelect'
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

  play(name, { volume = 1, rate = 1, pan = 0 } = {}) {
    if (!this.context || !this.master || this.muted || this.context.state !== 'running') return false;
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
    gain.gain.value = clamp(volume, 0, 1);
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

  playAt(name, x, y, listenerX, listenerY, { volume = 1, range = 720, yaw = 0, rate = 1 } = {}) {
    const dx = x - listenerX;
    const dy = y - listenerY;
    const distance = Math.hypot(dx, dy);
    if (distance >= range) return false;
    const attenuation = Math.pow(1 - distance / range, 1.45);
    const direction = Math.atan2(dy, dx) - yaw;
    return this.play(name, {
      volume: volume * attenuation,
      rate,
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
