// Интерфейс поверх 3D: полоски, инвентарь, пояс с оружием, крафт, мини-карта, чат, хранилище.
import {
  ITEMS, ITEM_KEYS, RES_KEYS, STRUCTURES, STRUCT_ORDER, MAP_W, MAP_H, TILE, lightAt,
  WEAPONS, WEAPON_ORDER, RECIPES, RECIPE_GROUPS, RAD,
} from '/shared/config.js';

const $ = (id) => document.getElementById(id);
const TILE_RGB = [[27, 79, 99], [60, 138, 134], [227, 208, 154], [120, 177, 83], [63, 128, 64], [143, 142, 134]];
const RECIPE_DESC = {
  arrows: 'Для лука и арбалета',
  bullets: 'Для самопала и дробовика',
  antirad: `Снимает ${RAD.antirad} ед. радиации (R)`,
};

function costText(cost, inv) {
  return Object.entries(cost).map(([k, v]) => {
    const poor = inv && (inv[k] || 0) < v;
    return `<span class="${poor ? 'poor' : ''}">${v}${ITEMS[k].icon}</span>`;
  }).join(' ');
}

export class Hud {
  constructor(send) {
    this.send = send;
    this.root = $('hud');
    this.bars = {
      hp: $('barHp'), food: $('barFood'), water: $('barWater'), sta: $('barSta'), rad: $('barRad'),
    };
    this.invEl = $('inv');
    this.invChips = {};
    for (const k of RES_KEYS) {
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
    this.beltEl = $('belt');
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
    this.craftEl = $('craft');
    this.radFx = $('radFx');
    this.cache = {};
    this.players = [];
    this.zones = [];
    this.buildSlots = [];
    this.belt = [];
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
    $('craftClose').addEventListener('click', () => this.toggleCraft(false));
  }

  show() {
    this.root.classList.remove('hidden');
  }

  setMap(tiles, zones) {
    this.zones = zones || [];
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
    // радиационные зоны — жёлто-зелёные круги
    for (const z of this.zones) {
      g.fillStyle = 'rgba(190, 230, 60, 0.35)';
      g.strokeStyle = 'rgba(230, 210, 40, 0.9)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(z.x / TILE, z.y / TILE, z.r / TILE, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    this.mapBase = base;
  }

  setBar(el, v, max, key) {
    const k = `${Math.round(v)}:${max}`;
    if (this.cache[key] === k) return;
    this.cache[key] = k;
    el.querySelector('.fill').style.width = `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
    el.querySelector('.num').textContent = Math.round(v);
    if (key === 'rad') el.classList.toggle('low', v >= RAD.dmgStart);
    else el.classList.toggle('low', key !== 'sta' && v / max < 0.2);
  }

  update(you, stats, ctx) {
    this.setBar(this.bars.hp, you.hp, you.mh, 'hp');
    this.setBar(this.bars.food, you.f, 100, 'food');
    this.setBar(this.bars.water, you.w, 100, 'water');
    this.setBar(this.bars.sta, you.sta, 100, 'sta');
    const showRad = you.rad > 0.5 || you.rz > 0;
    this.bars.rad.classList.toggle('hidden', !showRad);
    if (showRad) this.setBar(this.bars.rad, you.rad, 100, 'rad');
    // зелёная дымка по краям экрана в зоне радиации
    const radOp = Math.min(0.85, you.rz * 0.22 + (you.rad / 100) * 0.35);
    if (this.cache.radOp !== radOp.toFixed(2)) {
      this.cache.radOp = radOp.toFixed(2);
      this.radFx.style.opacity = radOp;
    }
    if (this.cache.dna !== you.dna) {
      this.cache.dna = you.dna;
      this.dnaVal.textContent = you.dna;
      this.btnEvolve.classList.toggle('ready', you.dna >= 10);
    }
    for (const k of RES_KEYS) {
      const v = you.inv[k];
      if (this.cache[`inv${k}`] === v) continue;
      this.cache[`inv${k}`] = v;
      this.invChips[k].querySelector('b').textContent = v;
      this.invChips[k].classList.toggle('zero', !v);
    }
    this.updateBelt(you, stats);
    this.updateAbilities(you, stats);
    this.updateBuildBar(you, ctx.buildKind);
    if (!this.craftEl.classList.contains('hidden')) this.renderCraft(you);
    let status = '';
    if (you.sp) status = '🛡 Защита после появления';
    else if (you.cb) status = '⚔ В бою — эволюция недоступна';
    else if (you.fire) status = '🔥 У костра: здоровье восстанавливается быстрее';
    if (you.rz > 0) status = `☢ Радиационная зона (уровень ${Math.ceil(you.rz)}) — облучение растёт`;
    if (you.rad >= RAD.dmgStart) status = '☢ Лучевая болезнь! Уйдите из зоны и примите антирад [R]';
    if (you.f <= 0 || you.w <= 0) status = '⚠ Вы голодаете — поешьте [F] или попейте у воды [E]';
    if (this.cache.status !== status) {
      this.cache.status = status;
      this.statusEl.textContent = status;
    }
  }

  // пояс: всё оружие, что есть в инвентаре; цифра — выбрать
  ownedWeapons(you) {
    return WEAPON_ORDER.filter((k) => you.inv[k] > 0);
  }

  updateBelt(you, stats) {
    const list = this.ownedWeapons(you);
    const sig = `${list.map((k) => `${k}${you.inv[k]}`).join(',')}|${you.wp}|${you.inv.arrows}|${you.inv.bullets}|${you.inv.stone}|${stats.canHold}`;
    if (this.cache.belt === sig) return;
    this.cache.belt = sig;
    this.belt = list;
    this.beltEl.classList.toggle('hidden', !list.length);
    this.beltEl.innerHTML = '';
    list.forEach((k, i) => {
      const w = WEAPONS[k];
      const el = document.createElement('div');
      el.className = `wslot${you.wp === k ? ' on' : ''}${stats.canHold ? '' : ' off'}`;
      el.title = `${ITEMS[k].name}: ${w.desc}`;
      let ammo = '';
      if (w.type === 'ranged') ammo = `${you.inv[w.ammo] || 0}${ITEMS[w.ammo].icon}`;
      else if (w.type === 'throw') ammo = `×${you.inv[k]}`;
      el.innerHTML = `<kbd>${i + 1}</kbd><div class="wi">${ITEMS[k].icon}</div><div class="wn">${ITEMS[k].name}</div><div class="wa">${ammo}</div>`;
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.onEquip?.(you.wp === k ? null : k);
      });
      this.beltEl.appendChild(el);
    });
  }

  updateAbilities(you, stats) {
    const w = you.wp ? WEAPONS[you.wp] : null;
    const atkIcon = you.wp ? ITEMS[you.wp].icon : '🐾';
    const atkName = you.wp ? ITEMS[you.wp].name.split(' ').pop() : 'Удар';
    const list = [
      { key: 'ЛКМ', ic: atkIcon, nm: atkName, cd: you.cd.m, max: w ? w.cd : stats.attackCd, on: true },
      { key: 'Q', ic: '🧪', nm: 'Кислота', cd: you.cd.s, max: stats.spit ? stats.spit.cd : 1, on: !!stats.spit },
      { key: '␣', ic: '🦏', nm: 'Таран', cd: you.cd.c, max: stats.charge ? stats.charge.cd : 1, on: !!stats.charge },
      { key: 'F', ic: '🍖', nm: 'Есть', cd: 0, max: 1, on: you.inv.berries + you.inv.meat > 0 },
      { key: 'R', ic: '💊', nm: `Антирад ${you.inv.antirad || ''}`, cd: 0, max: 1, on: you.inv.antirad > 0 },
    ];
    const sig = list.map((a) => `${a.on}${a.ic}${a.nm}${Math.ceil(a.cd * 10)}`).join('|');
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
      el.classList.toggle('poor', Object.entries(cost).some(([r, v]) => (you.inv[r] || 0) < v));
    }
  }

  // ---------- крафт ----------
  toggleCraft(on) {
    const show = on ?? this.craftEl.classList.contains('hidden');
    this.craftEl.classList.toggle('hidden', !show);
    this.cache.craft = null;
    return show;
  }

  renderCraft(you) {
    const sig = `${ITEM_KEYS.map((k) => you.inv[k] || 0).join(',')}|${you.bench}`;
    if (this.cache.craft === sig) return;
    this.cache.craft = sig;
    const body = $('craftBody');
    body.innerHTML = '';
    for (const [title, items] of RECIPE_GROUPS) {
      const h = document.createElement('div');
      h.className = 'craft-group';
      h.textContent = title;
      body.appendChild(h);
      for (const k of items) {
        const rec = RECIPES[k];
        const poor = Object.entries(rec.cost).some(([r, v]) => (you.inv[r] || 0) < v);
        const needBench = rec.bench && !you.bench;
        const row = document.createElement('div');
        row.className = 'crow2';
        const w = WEAPONS[k];
        const desc = w ? w.desc : RECIPE_DESC[k] || '';
        const stat = w ? (w.type === 'melee' ? `+${w.dmg} урона` : w.type === 'throw' ? `${w.dmg} урона, взрыв` : `${w.dmg}${w.pellets ? `×${w.pellets}` : ''} урона`) : '';
        const have = you.inv[k] ? ` <span class="muted">(есть ${you.inv[k]})</span>` : '';
        row.innerHTML = `<div class="ci">${ITEMS[k].icon}</div>
          <div class="cn"><b>${ITEMS[k].name}${rec.out > 1 ? ` ×${rec.out}` : ''}</b>${have}<div class="cd">${desc}${stat ? ` · ${stat}` : ''}${rec.bench ? ' · <span class="bench">нужен верстак</span>' : ''}</div></div>
          <div class="cc">${costText(rec.cost, you.inv)}</div>`;
        const b = document.createElement('button');
        b.textContent = 'Создать';
        b.disabled = poor || needBench;
        b.title = needBench ? 'Подойдите к верстаку' : poor ? 'Не хватает ресурсов' : '';
        b.addEventListener('click', () => this.send({ t: 'craft', item: k }));
        row.appendChild(b);
        body.appendChild(row);
      }
    }
  }

  clock(phase) {
    const L = lightAt(phase);
    const night = L < 0.5;
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
    for (const st of myStructures) g.fillRect(st.x * s - 1, st.y * s - 1, 2.5, 2.5);
    g.font = '10px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const z of this.zones) {
      g.fillStyle = '#1d1d1f';
      g.fillText('☢', z.x * s, z.y * s);
    }
    if (nest) {
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.arc(nest[0] * s, nest[1] * s, 3.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.stroke();
    }
    if (meteor) {
      g.strokeStyle = '#c77dff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(meteor.x * s, meteor.y * s, 5 + Math.sin(t * 5) * 2, 0, Math.PI * 2);
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
      g.moveTo(7, 0);
      g.lineTo(-4.5, 4.5);
      g.lineTo(-2, 0);
      g.lineTo(-4.5, -4.5);
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

  // ---------- хранилище / останки / ящик ----------
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
    let rows = 0;
    for (const k of keys) {
      const isDna = k === 'dna';
      const inside = isDna ? c.dna : c.inv[k] || 0;
      const mine = isDna ? you.dna : you.inv[k] || 0;
      // показываем только то, что есть у вас или внутри
      if (c.remains ? !inside : !inside && !mine) continue;
      rows++;
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
    if (!rows) {
      const empty = document.createElement('div');
      empty.className = 'muted small';
      empty.style.padding = '8px 0';
      empty.textContent = 'Пусто';
      body.appendChild(empty);
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
      const total = ITEM_KEYS.reduce((a, k) => a + (c.inv[k] || 0), 0);
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
