// Интерфейс поверх 3D: полоски, инвентарь, мини-карта, чат, хранилище, подсказки.
import { ITEMS, ITEM_KEYS, STRUCTURES, STRUCT_ORDER, MAP_W, MAP_H, TILE, lightAt } from '/shared/config.js';

const $ = (id) => document.getElementById(id);
const TILE_RGB = [[27, 79, 99], [60, 138, 134], [227, 208, 154], [120, 177, 83], [63, 128, 64], [143, 142, 134]];

function costText(cost) {
  return Object.entries(cost).map(([k, v]) => `${v}${ITEMS[k].icon}`).join(' ');
}

export class Hud {
  constructor(send) {
    this.send = send;
    this.root = $('hud');
    this.bars = {
      hp: $('barHp'), food: $('barFood'), water: $('barWater'), sta: $('barSta'),
    };
    this.invEl = $('inv');
    this.invChips = {};
    for (const k of ITEM_KEYS) {
      const c = document.createElement('div');
      c.className = 'chip';
      c.title = ITEMS[k].name;
      c.innerHTML = `<span>${ITEMS[k].icon}</span><b>0</b>`;
      this.invEl.appendChild(c);
      this.invChips[k] = c;
    }
    this.dnaVal = $('dnaVal');
    this.btnEvolve = $('btnEvolve');
    this.abilitiesEl = $('abilities');
    this.statusEl = $('status');
    this.hintEl = $('hint');
    this.clockEl = $('clock');
    this.toastsEl = $('toasts');
    this.chatLog = $('chatLog');
    this.chatInput = $('chatInput');
    this.chatEl = $('chat');
    this.playerListEl = $('playerList');
    this.minimap = $('minimap');
    this.mctx = this.minimap.getContext('2d');
    this.buildBar = $('buildBar');
    this.contEl = $('container');
    this.cache = {};
    this.players = [];
    this.buildSlots = [];
    STRUCT_ORDER.forEach((k, i) => {
      const d = STRUCTURES[k];
      const el = document.createElement('div');
      el.className = 'bslot';
      el.title = d.desc;
      el.innerHTML = `<kbd>${i + 1}</kbd><div class="bn">${d.name}</div><div class="bc">${costText(d.cost)}</div>`;
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.onPickBuild?.(k);
      });
      this.buildBar.appendChild(el);
      this.buildSlots.push({ k, el });
    });
    $('contClose').addEventListener('click', () => this.onCloseCont?.());
  }

  show() {
    this.root.classList.remove('hidden');
  }

  setMap(tiles) {
    const base = document.createElement('canvas');
    base.width = MAP_W;
    base.height = MAP_H;
    const g = base.getContext('2d');
    const img = g.createImageData(MAP_W, MAP_H);
    for (let i = 0; i < tiles.length; i++) {
      const c = TILE_RGB[tiles[i]];
      img.data[i * 4] = c[0];
      img.data[i * 4 + 1] = c[1];
      img.data[i * 4 + 2] = c[2];
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.mapBase = base;
  }

  setBar(el, v, max, key) {
    const k = `${key}:${Math.round(v)}:${max}`;
    if (this.cache[key] === k) return;
    this.cache[key] = k;
    el.querySelector('.fill').style.width = `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
    el.querySelector('.num').textContent = Math.round(v);
    el.classList.toggle('low', key !== 'sta' && v / max < 0.2);
  }

  update(you, stats, ctx) {
    this.setBar(this.bars.hp, you.hp, you.mh, 'hp');
    this.setBar(this.bars.food, you.f, 100, 'food');
    this.setBar(this.bars.water, you.w, 100, 'water');
    this.setBar(this.bars.sta, you.sta, 100, 'sta');
    if (this.cache.dna !== you.dna) {
      this.cache.dna = you.dna;
      this.dnaVal.textContent = you.dna;
      this.btnEvolve.classList.toggle('ready', you.dna >= 10);
    }
    for (const k of ITEM_KEYS) {
      const v = you.inv[k];
      if (this.cache[`inv${k}`] === v) continue;
      this.cache[`inv${k}`] = v;
      this.invChips[k].querySelector('b').textContent = v;
      this.invChips[k].classList.toggle('zero', !v);
    }
    this.updateAbilities(you, stats);
    this.updateBuildBar(you, ctx.buildKind);
    let status = '';
    if (you.sp) status = '🛡 Защита после появления';
    else if (you.cb) status = '⚔ В бою — эволюция недоступна';
    else if (you.fire) status = '🔥 У костра: здоровье восстанавливается быстрее';
    if (you.f <= 0 || you.w <= 0) status = '⚠ Вы голодаете — поешьте [F] или попейте у воды [E]';
    if (this.cache.status !== status) {
      this.cache.status = status;
      this.statusEl.textContent = status;
    }
  }

  updateAbilities(you, stats) {
    const list = [
      { key: 'ЛКМ', ic: '🗡️', nm: 'Удар', cd: you.cd.m, max: stats.attackCd, on: true },
      { key: 'ПКМ', ic: '🧪', nm: 'Кислота', cd: you.cd.s, max: stats.spit ? stats.spit.cd : 1, on: !!stats.spit },
      { key: '␣', ic: '🦏', nm: 'Таран', cd: you.cd.c, max: stats.charge ? stats.charge.cd : 1, on: !!stats.charge },
      { key: 'F', ic: '🍖', nm: 'Есть', cd: 0, max: 1, on: you.inv.berries + you.inv.meat > 0 },
    ];
    const sig = list.map((a) => `${a.on}${Math.ceil(a.cd * 10)}`).join('|');
    if (this.cache.ab === sig) return;
    this.cache.ab = sig;
    this.abilitiesEl.innerHTML = list.map((a) => `
      <div class="ab ${a.on ? '' : 'off'}"><kbd>${a.key}</kbd><div class="ic">${a.ic}</div><div class="nm">${a.nm}</div>
      <div class="cdv" style="height:${a.on && a.cd > 0 ? Math.min(100, (a.cd / a.max) * 100) : 0}%"></div></div>`).join('');
  }

  updateBuildBar(you, kind) {
    this.buildBar.classList.toggle('hidden', !kind);
    if (!kind) return;
    for (const { k, el } of this.buildSlots) {
      el.classList.toggle('on', k === kind);
      const cost = STRUCTURES[k].cost;
      el.classList.toggle('poor', Object.entries(cost).some(([r, v]) => you.inv[r] < v));
    }
  }

  clock(phase) {
    const L = lightAt(phase);
    const night = L < 0.5;
    // фазы: день до 0.55, закат до 0.65, ночь до 0.92, рассвет до 1
    let label;
    if (phase < 0.55) label = `☀️ День · до заката ${Math.round((0.55 - phase) * 420)} с`;
    else if (phase < 0.65) label = '🌇 Закат';
    else if (phase < 0.92) label = `🌙 Ночь · до рассвета ${Math.round((0.92 - phase) * 420)} с`;
    else label = '🌅 Рассвет';
    if (this.cache.clock !== label) {
      this.cache.clock = label;
      this.clockEl.textContent = label;
      this.clockEl.style.color = night ? '#a9b8ff' : '#ffe9b0';
    }
  }

  drawMinimap(me, face, nest, meteor, myStructures, t) {
    const g = this.mctx;
    const W = this.minimap.width;
    const s = W / (MAP_W * TILE);
    g.imageSmoothingEnabled = false;
    if (this.mapBase) g.drawImage(this.mapBase, 0, 0, W, W);
    g.fillStyle = '#ffffff';
    for (const st of myStructures) g.fillRect(st.x * s - 1.5, st.y * s - 1.5, 3, 3);
    if (nest) {
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.arc(nest[0] * s, nest[1] * s, 4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.stroke();
    }
    if (meteor) {
      g.strokeStyle = '#c77dff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(meteor.x * s, meteor.y * s, 6 + Math.sin(t * 5) * 2.5, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#c77dff';
      g.fillRect(meteor.x * s - 1.5, meteor.y * s - 1.5, 3, 3);
    }
    if (me) {
      g.save();
      g.translate(me.x * s, me.y * s);
      g.rotate(face);
      g.fillStyle = '#9cf0a4';
      g.strokeStyle = '#0b1016';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(8, 0);
      g.lineTo(-5, 5);
      g.lineTo(-2, 0);
      g.lineTo(-5, -5);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
  }

  setHint(html) {
    if (this.cache.hint === html) return;
    this.cache.hint = html;
    this.hintEl.innerHTML = html;
  }

  toast(text, big = false) {
    const el = document.createElement('div');
    el.className = `toast${big ? ' big' : ''}`;
    el.textContent = text;
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => { el.style.opacity = '0'; }, big ? 6000 : 3000);
    setTimeout(() => el.remove(), big ? 6600 : 3600);
  }

  chat(m) {
    const el = document.createElement('div');
    el.className = `msg${m.sys ? ' sys' : ''}`;
    if (m.sys) el.textContent = m.text;
    else {
      const n = document.createElement('b');
      n.textContent = `${m.n}: `;
      n.style.color = m.c;
      el.appendChild(n);
      el.appendChild(document.createTextNode(m.text));
    }
    this.chatLog.appendChild(el);
    while (this.chatLog.children.length > 40) this.chatLog.firstChild.remove();
    setTimeout(() => el.classList.add('old'), 12000);
  }

  openChat() {
    this.chatEl.classList.add('open');
    this.chatInput.classList.remove('hidden');
    this.chatInput.value = '';
    this.chatInput.focus();
  }

  closeChat() {
    this.chatEl.classList.remove('open');
    this.chatInput.classList.add('hidden');
    this.chatInput.blur();
  }

  setPlayers(list) {
    this.players = list;
    if (!this.playerListEl.classList.contains('hidden')) this.renderPlayers();
  }

  togglePlayers(on) {
    this.playerListEl.classList.toggle('hidden', !on);
    if (on) this.renderPlayers();
  }

  renderPlayers() {
    const rows = this.players.map((p) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = p.n;
      name.style.color = p.c;
      const k = document.createElement('td');
      k.textContent = p.k;
      const cx = document.createElement('td');
      cx.textContent = `${p.cx}/12`;
      tr.append(name, k, cx);
      return tr;
    });
    this.playerListEl.innerHTML = `<table><thead><tr><th>Игрок (${this.players.length})</th><th>Убийства</th><th>Мутации</th></tr></thead><tbody></tbody></table>`;
    this.playerListEl.querySelector('tbody').append(...rows);
  }

  // ---------- хранилище / останки ----------
  openContainer(c, you) {
    this.cont = c;
    this.contEl.classList.remove('hidden');
    $('contTitle').textContent = c.title;
    this.renderContainer(you);
  }

  renderContainer(you) {
    const c = this.cont;
    if (!c) return;
    const body = $('contBody');
    body.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'crow';
    head.innerHTML = '<span></span><span class="muted small">У вас → внутри</span><span></span>';
    body.appendChild(head);
    const keys = [...ITEM_KEYS];
    if (c.remains) keys.push('dna');
    for (const k of keys) {
      const isDna = k === 'dna';
      const inside = isDna ? c.dna : c.inv[k];
      const mine = isDna ? you.dna : you.inv[k];
      if (c.remains && !inside) continue;
      const row = document.createElement('div');
      row.className = 'crow';
      row.innerHTML = `<span>${isDna ? '🧬' : ITEMS[k].icon}</span><span>${isDna ? 'ДНК' : ITEMS[k].name}<br><span class="cnt">${mine} → ${inside}</span></span>`;
      const btns = document.createElement('div');
      btns.className = 'btns';
      const mk = (label, op, n, disabled) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.disabled = disabled;
        b.addEventListener('click', () => this.send({ t: 'cont', id: c.id, op, res: k, n }));
        btns.appendChild(b);
      };
      if (!c.remains) {
        mk('→10', 'put', 10, !mine);
        mk('→все', 'put', 'all', !mine);
      }
      mk('←10', 'take', 10, !inside);
      mk('←все', 'take', 'all', !inside);
      row.appendChild(btns);
      body.appendChild(row);
    }
    if (c.remains) {
      const all = document.createElement('button');
      all.className = 'primary';
      all.style.marginTop = '8px';
      all.style.width = '100%';
      all.textContent = 'Забрать всё';
      all.addEventListener('click', () => {
        for (const k of keys) {
          const inside = k === 'dna' ? c.dna : c.inv[k];
          if (inside) this.send({ t: 'cont', id: c.id, op: 'take', res: k, n: 'all' });
        }
      });
      body.appendChild(all);
    } else {
      const total = ITEM_KEYS.reduce((a, k) => a + c.inv[k], 0);
      const cap = document.createElement('div');
      cap.className = 'cont-cap';
      cap.textContent = `Заполнено: ${total} / ${c.cap}`;
      body.appendChild(cap);
    }
  }

  closeContainer() {
    this.cont = null;
    this.contEl.classList.add('hidden');
  }
}
