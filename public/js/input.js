// Клавиатура, мышь и камера от третьего лица.
// Используем e.code (физические клавиши), чтобы управление работало и в русской раскладке.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.mouse = { l: false, r: false };
    this.cam = { yaw: -Math.PI / 2, pitch: 0.32, dist: 210 };
    this.locked = false;
    this.dragMode = false; // запасной режим, если захват мыши недоступен
    this.enabled = false; // false, когда открыт чат, редактор и т.п.
    this.onPress = null; // (code, event) — одиночные нажатия
    this.onClickWorld = null; // клик ЛКМ по миру (стройка)
    this.drag = null;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      const first = !this.keys[e.code];
      this.keys[e.code] = true;
      if (first && this.onPress) this.onPress(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (this.onRelease) this.onRelease(e.code, e);
    });
    window.addEventListener('blur', () => this.clear());

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked && !this.dragMode) {
        this.requestLock();
        return;
      }
      if (this.dragMode && e.button === 0) {
        this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
        return;
      }
      if (e.button === 0) {
        if (this.onClickWorld && this.onClickWorld()) return;
        this.mouse.l = true;
      }
      if (e.button === 2) this.mouse.r = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        if (this.dragMode && this.drag) {
          // короткий щелчок без движения — удар
          if (this.drag.moved < 6 && this.enabled && !(this.onClickWorld && this.onClickWorld())) {
            this.mouse.l = true;
            setTimeout(() => { this.mouse.l = false; }, 120);
          }
          this.drag = null;
        }
        if (!this.dragMode) this.mouse.l = false;
      }
      if (e.button === 2) this.mouse.r = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) this.look(e.movementX, e.movementY);
      else if (this.dragMode && this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.look(dx * 1.4, dy * 1.4);
      }
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(60, Math.min(650, this.cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.mouse.l = false;
        this.mouse.r = false;
      }
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.dragMode = true;
      this.onLockChange?.(false);
    });
  }

  look(dx, dy) {
    this.cam.yaw += dx * 0.0026;
    this.cam.pitch = Math.max(0.04, Math.min(1.35, this.cam.pitch + dy * 0.0022));
  }

  requestLock() {
    try {
      const r = this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => { this.dragMode = true; this.onLockChange?.(false); });
    } catch {
      this.dragMode = true;
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear() {
    for (const k in this.keys) this.keys[k] = false;
    this.mouse.l = false;
    this.mouse.r = false;
  }

  // Направление движения в мировых координатах (x, y) относительно камеры
  moveVector() {
    if (!this.enabled) return { x: 0, y: 0 };
    const k = this.keys;
    let f = 0;
    let s = 0;
    if (k.KeyW || k.ArrowUp) f += 1;
    if (k.KeyS || k.ArrowDown) f -= 1;
    if (k.KeyD || k.ArrowRight) s += 1;
    if (k.KeyA || k.ArrowLeft) s -= 1;
    const cy = Math.cos(this.cam.yaw);
    const sy = Math.sin(this.cam.yaw);
    let x = cy * f - sy * s;
    let y = sy * f + cy * s;
    const len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }
}
