// Клавиатура, мышь и камера от третьего лица.
// Курсор свободный: им целятся. Камеру вращают, потянув зажатой ЛКМ, ПКМ или колёсиком-кнопкой, и стрелками.
// Используем e.code (физические клавиши), чтобы управление работало и в русской раскладке.
const ROT_THRESHOLD = 5; // сколько пикселей нужно протянуть ПКМ, чтобы это считалось вращением, а не щелчком

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.mouse = { l: false };
    this.pos = { x: window.innerWidth / 2, y: window.innerHeight / 2, inside: false };
    this.cam = { yaw: -Math.PI / 2, pitch: 0.55, dist: 260 };
    this.enabled = false; // false, когда открыт чат, редактор и т.п.
    this.onPress = null; // (code) — одиночные нажатия
    this.onRelease = null;
    this.onLeftDown = null; // ЛКМ по миру; вернуть true, если нажатие обработано (стройка)
    this.onRightClick = null; // короткий щелчок ПКМ без протягивания
    this.rot = null; // активное вращение камеры мышью
    this.suppressed = new Set(); // клавиши, которые игнорируются до следующего отпускания

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (this.suppressed.has(e.code)) return;
      const first = !this.keys[e.code];
      this.keys[e.code] = true;
      if (first && this.onPress) this.onPress(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.suppressed.delete(e.code);
      this.keys[e.code] = false;
      if (this.onRelease) this.onRelease(e.code, e);
    });
    window.addEventListener('blur', () => {
      // вне окна отпускание клавиш не видно — считаем, что всё отпущено
      this.suppressed.clear();
      this.clear();
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousemove', (e) => {
      this.pos.x = e.clientX;
      this.pos.y = e.clientY;
      this.pos.inside = true;
    });
    canvas.addEventListener('mouseleave', () => {
      this.pos.inside = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.pos.x = e.clientX;
      this.pos.y = e.clientY;
      this.pos.inside = true;
      if (e.button === 0) {
        if (this.onLeftDown && this.onLeftDown()) return;
        this.mouse.l = true;
        this.lastClick = performance.now();
        // ЛКМ тоже вращает камеру, если её потянуть (удар при этом отменяется)
        this.rot = { x: e.clientX, y: e.clientY, moved: 0, button: 0 };
      } else if (e.button === 1 || e.button === 2) {
        e.preventDefault();
        this.rot = { x: e.clientX, y: e.clientY, moved: 0, button: e.button };
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.rot) return;
      const dx = e.clientX - this.rot.x;
      const dy = e.clientY - this.rot.y;
      this.rot.moved += Math.abs(dx) + Math.abs(dy);
      this.rot.x = e.clientX;
      this.rot.y = e.clientY;
      if (this.rot.moved > ROT_THRESHOLD) {
        if (this.rot.button === 0) {
          this.mouse.l = false;
          this.lastClick = 0;
        }
        this.look(dx, dy);
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.l = false;
      if (this.rot && e.button === this.rot.button) {
        const click = this.rot.button === 2 && this.rot.moved <= ROT_THRESHOLD;
        this.rot = null;
        if (click && this.enabled) this.onRightClick?.();
      }
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(90, Math.min(650, this.cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: false });
  }

  get rotating() {
    return !!this.rot && this.rot.moved > ROT_THRESHOLD;
  }

  look(dx, dy) {
    this.cam.yaw += dx * 0.005;
    this.cam.pitch = Math.max(0.15, Math.min(1.3, this.cam.pitch + dy * 0.004));
  }

  // вращение камеры стрелками
  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;
    if (k.ArrowLeft) this.cam.yaw -= 1.8 * dt;
    if (k.ArrowRight) this.cam.yaw += 1.8 * dt;
    if (k.ArrowUp) this.cam.pitch = Math.min(1.3, this.cam.pitch + 0.9 * dt);
    if (k.ArrowDown) this.cam.pitch = Math.max(0.15, this.cam.pitch - 0.9 * dt);
  }

  clear() {
    for (const k in this.keys) this.keys[k] = false;
    this.mouse.l = false;
    this.rot = null;
  }

  // Зажатые сейчас клавиши перестают действовать, пока их не отпустят и не нажмут снова.
  // Нужно после смерти: иначе существо сразу побежит туда, куда бежало до гибели.
  suppressHeld() {
    for (const k in this.keys) if (this.keys[k]) this.suppressed.add(k);
    this.clear();
  }

  // Направление движения в мировых координатах (x, y) относительно камеры
  moveVector() {
    if (!this.enabled) return { x: 0, y: 0 };
    const k = this.keys;
    let f = 0;
    let s = 0;
    if (k.KeyW) f += 1;
    if (k.KeyS) f -= 1;
    if (k.KeyD) s += 1;
    if (k.KeyA) s -= 1;
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
