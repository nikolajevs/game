// Небольшая 3D-витрина персонажа: экран входа и редактор мутаций.
// С внешностью (ap) показывает человека, без неё — дикое существо.
import * as THREE from 'three';
import { Creature3D } from './gfx/creature3d.js';
import { Human3D } from './gfx/human3d.js';

export class CreaturePreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, canvas.width / canvas.height, 1, 2000);
    this.scene.add(new THREE.HemisphereLight('#dfefff', '#3a3a2a', 1.3));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    sun.position.set(60, 120, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -80;
    sc.right = 80;
    sc.top = 80;
    sc.bottom = -80;
    this.scene.add(sun);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(70, 32),
      new THREE.MeshStandardMaterial({ color: '#3a5a3a', roughness: 1, transparent: true, opacity: 0.55 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.creature = null;
    this.key = '';
    this.yaw = 0.7;
    this.running = false;
    this.attackTimer = 2;

    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag === null) return;
      this.yaw += (e.clientX - drag) * 0.012;
      drag = e.clientX;
    });
    canvas.addEventListener('pointerup', () => {
      drag = null;
    });
  }

  set(look, color, ap = null) {
    const key = `${look}|${color}|${ap}`;
    if (key === this.key) return;
    this.key = key;
    if (this.creature) {
      this.scene.remove(this.creature.group);
      this.creature.dispose();
    }
    this.human = !!ap;
    this.creature = ap ? new Human3D(ap, look, color) : new Creature3D(look, color);
    this.scene.add(this.creature.group);
    if (this.human) {
      // человек выше, чем шире: смотрим на грудь, чуть сверху
      const s = this.creature.size;
      this.target = new THREE.Vector3(0, 25 * s, 0);
      this.distance = 105 * s;
      this.lift = 0.12;
    } else {
      const R = this.creature.R;
      const h = this.creature.tpl.hb;
      this.target = new THREE.Vector3(R * 0.1, h * 0.7, 0);
      this.distance = 80 + R * 4.8;
      this.lift = 0.42;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.render(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  render(dt) {
    const w = this.canvas.clientWidth || this.canvas.width;
    const h = this.canvas.clientHeight || this.canvas.height;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (!this.creature) return;
    this.yaw += dt * (this.human ? 0.15 : 0.25);
    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      this.attackTimer = this.human ? 5 + Math.random() * 3 : 2.5 + Math.random() * 2;
      this.creature.attack();
    }
    this.creature.update(dt, { speed: this.human ? 0 : 45 });
    const d = this.distance;
    this.camera.position.set(this.target.x + Math.cos(this.yaw) * d, this.target.y + d * this.lift, this.target.z + Math.sin(this.yaw) * d);
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
