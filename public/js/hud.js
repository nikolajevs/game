// Интерфейс поверх 3D: полоски, инвентарь, пояс с оружием, крафт, мини-карта, чат, хранилище.
import {
  ITEMS, ITEM_KEYS, RES_KEYS, STRUCTURES, BUILD_CATS, repairCost, demolishRefund, MAP_W, MAP_H, TILE, lightAt,
  WEAPONS, WEAPON_ORDER, RECIPES, CRAFT_TABS, CRAFT_MAX, USES, RAD, SITES, ABILITIES, ABILITY_ORDER, FOOD,
} from '/shared/config.js';

const MINI_SPAN = 4800; // сколько единиц мира видно на мини-карте
const WORLD = MAP_W * TILE;

const $ = (id) => document.getElementById(id);
const TILE_RGB = [[27, 79, 99], [60, 138, 134], [227, 208, 154], [120, 177, 83], [63, 128, 64], [143, 142, 134], [92, 88, 84], [34, 31, 29]];
const RECIPE_DESC = {
  cell: 'Боеприпас лазерной винтовки',
  arrows: 'Для лука и арбалета',
  bullets: 'Для самопала и дробовика',
  antirad: `Снимает ${RAD.antirad} ед. радиации (R)`,
  elixir: `Возвращает ${USES.elixir.mana} маны и ${USES.elixir.hp} здоровья (T)`,
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
      hp: $('barHp'), food: $('barFood'), water: $('barWater'), sta: $('barSta'), rad: $('barRad'), mana: $('barMana'),
    };
    this.knowVal = $('knowVal');
    this.spiritVal = $('spiritVal');
    this.invEl = $('inv');
    this.invChips = {};
    for (const k of RES_KEYS) {
      const c = document.createElement('div');
      c.className = 'chip';
      c.title = ITEMS[k].name;
      c.innerHTML = `<span>${ITEMS[k].icon}</span><b>0</b>`;
      // еду можно съесть щелчком; грибы-галлюциногены — только так (F их не трогает)
      if (FOOD[k]) {
        c.classList.add('food');
        c.title = `${ITEMS[k].name} — щёлкните, чтобы съесть${FOOD[k].hal ? ' (галлюцинации!)' : ''}`;
        c.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (c.classList.contains('zero')) return;
          this.send({ t: 'eat', item: k });
        });
      }
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
    this.bigOpen = false;
    this.marker = null; // метка игрока на карте { x, y }
    this.minimap.addEventListener('click', () => this.toggleBigMap());
    this.initBigMap();
    this.contEl = $('container');
    this.craftEl = $('craft');
    this.radFx = $('radFx');
    this.cache = {};
    this.players = [];
    this.zones = [];
    this.belt = [];
    this.initBuildMenu();
    $('contClose').addEventListener('click', () => this.onCloseCont?.());
    $('craftClose').addEventListener('click', () => this.toggleCraft(false));
    this.initCraft();
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
    // особые места: руины — жёлто-зелёные, рудники — охристые, логова — бурые
    const SITE_COLORS = {
      ruins: ['rgba(190, 230, 60, 0.35)', 'rgba(230, 210, 40, 0.9)'],
      mine: ['rgba(200, 150, 80, 0.35)', 'rgba(230, 170, 70, 0.9)'],
      lair: ['rgba(150, 70, 50, 0.35)', 'rgba(200, 90, 60, 0.9)'],
      altar: ['rgba(160, 90, 220, 0.35)', 'rgba(199, 125, 255, 0.95)'],
      city: ['rgba(0, 0, 0, 0)', 'rgba(255, 190, 90, 0.75)'], // сам город виден по клеткам — только контур
      crater: ['rgba(190, 230, 60, 0.4)', 'rgba(230, 210, 40, 0.95)'],
    };
    for (const z of this.zones) {
      const [fill, stroke] = SITE_COLORS[z.kind] || SITE_COLORS.ruins;
      g.fillStyle = fill;
      g.strokeStyle = stroke;
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
    const showMana = you.pa === 'spirit';
    this.bars.mana.classList.toggle('hidden', !showMana);
    if (showMana) this.setBar(this.bars.mana, you.mn, you.mm, 'mana');
    if (this.cache.pts !== `${you.kn}|${you.spi}`) {
      this.cache.pts = `${you.kn}|${you.spi}`;
      this.knowVal.textContent = you.kn || 0;
      this.spiritVal.textContent = you.spi || 0;
    }
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
    this.updateBuildMenu(you, ctx.build);
    if (!this.craftEl.classList.contains('hidden')) this.renderCraft(you);
    let status = '';
    if (you.sp) status = '🛡 Защита после появления';
    else if (you.cb) status = '⚔ В бою — мутировать нельзя';
    else if (you.fire) status = '🔥 У костра: здоровье восстанавливается быстрее';
    else if (you.lab) status = '🔬 Лаборатория рядом: изучайте данные и ставьте опыты в окне пути (P), крафтите технологии (C)';
    if (you.hal > 0) status = `${you.hs >= 1 ? '💠' : '🍄'} Галлюцинации: ещё ${Math.ceil(you.hal)} с — не всему, что видите, можно верить`;
    if (you.med) status = '🕯 Медитация у алтаря: сила духа копится, мана восстанавливается быстрее';
    if (you.sh > 0) status = `🛡 Щит духа: ${you.sh}`;
    if (you.rz > 0) status = `☢ ${this.siteName || 'Радиационная зона'} (радиация ${Math.ceil(you.rz)}) — облучение растёт, копится мутаген`;
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

  // заклинания и мгновенные умения пути — тоже в поясе, после оружия
  ownedSkills(you) {
    const has = new Set(you.ab || []);
    return ABILITY_ORDER.filter((id) => has.has(id) && (ABILITIES[id].kind === 'spell' || ABILITIES[id].kind === 'instant'));
  }

  updateBelt(you, stats) {
    const list = [...this.ownedWeapons(you), ...this.ownedSkills(you)];
    const cds = list.map((k) => (you.acd?.[k] ? Math.ceil(you.acd[k] * 4) : 0)).join(',');
    const sig = `${list.map((k) => `${k}${you.inv[k]}`).join(',')}|${you.wp}|${you.inv.arrows}|${you.inv.bullets}|${you.inv.stone}|${you.inv.cell}|${stats.canHold}|${cds}|${Math.floor((you.mn || 0) / 5)}`;
    if (this.cache.belt === sig) return;
    this.cache.belt = sig;
    this.belt = list;
    this.beltEl.classList.toggle('hidden', !list.length);
    this.beltEl.innerHTML = '';
    list.forEach((k, i) => {
      const ab = ABILITIES[k];
      if (ab) {
        // умение пути: заклинание (выбрать) или мгновенное (применить сразу)
        const el = document.createElement('div');
        const lowMana = ab.mana && (you.mn || 0) < ab.mana;
        el.className = `wslot ${ab.path === 'spirit' ? 'spell' : 'tech'}${you.wp === k ? ' on' : ''}${lowMana ? ' off' : ''}`;
        el.title = `${ab.name}: ${ab.desc}`;
        const cd = you.acd?.[k] || 0;
        el.innerHTML = `<kbd>${i + 1}</kbd><div class="wi">${ab.icon}</div><div class="wn">${ab.short || ab.name}</div><div class="wa">${ab.mana ? `${ab.mana}✦` : ab.kind === 'instant' ? 'сразу' : ''}</div>${cd > 0 ? `<div class="wcd" style="height:${Math.min(100, (cd / ab.cd) * 100)}%"></div>` : ''}`;
        el.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.onSkill?.(k);
        });
        this.beltEl.appendChild(el);
        return;
      }
      const w = WEAPONS[k];
      const el = document.createElement('div');
      el.className = `wslot${you.wp === k ? ' on' : ''}${stats.canHold ? '' : ' off'}`;
      el.title = `${ITEMS[k].name}: ${w.desc}`;
      let ammo = '';
      if (w.mana) ammo = `${w.mana}✦`;
      else if (w.type === 'ranged') ammo = `${you.inv[w.ammo] || 0}${ITEMS[w.ammo].icon}`;
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
    const spell = you.wp ? ABILITIES[you.wp] : null;
    const w = you.wp && !spell ? WEAPONS[you.wp] : null;
    const atkIcon = spell ? spell.icon : you.wp ? ITEMS[you.wp].icon : '🐾';
    const atkName = spell ? spell.short || spell.name : you.wp ? ITEMS[you.wp].name.split(' ').pop() : 'Удар';
    const list = [
      { key: 'ЛКМ', ic: atkIcon, nm: atkName, cd: you.cd.m, max: w ? w.cd : stats.attackCd, on: true },
      { key: 'Q', ic: '🧪', nm: 'Кислота', cd: you.cd.s, max: stats.spit ? stats.spit.cd : 1, on: !!stats.spit },
      { key: '␣', ic: '🦏', nm: 'Таран', cd: you.cd.c, max: stats.charge ? stats.charge.cd : 1, on: !!stats.charge },
      { key: 'F', ic: '🍖', nm: 'Есть', cd: 0, max: 1, on: you.inv.berries + you.inv.meat > 0 },
      { key: 'R', ic: '💊', nm: `Антирад ${you.inv.antirad || ''}`, cd: 0, max: 1, on: you.inv.antirad > 0 },
    ];
    if (you.inv.elixir > 0) list.push({ key: 'T', ic: ITEMS.elixir.icon, nm: `Эликсир ${you.inv.elixir}`, cd: 0, max: 1, on: true });
    const sig = list.map((a) => `${a.on}${a.ic}${a.nm}${Math.ceil(a.cd * 10)}`).join('|');
    if (this.cache.ab === sig) return;
    this.cache.ab = sig;
    this.abilitiesEl.innerHTML = list.map((a) => `
      <div class="ab ${a.on ? '' : 'off'}"><kbd>${a.key}</kbd><div class="ic">${a.ic}</div><div class="nm">${a.nm}</div>
      <div class="cdv" style="height:${a.on && a.cd > 0 ? Math.min(100, (a.cd / a.max) * 100) : 0}%"></div></div>`).join('');
  }

  // ---------- меню стройки ----------
  // Шапка: разделы (Q/E) и инструменты — строить, чинить (R), снести (X). Ниже — карточки построек
  // раздела с моделями-иконками (1–9) и справка: цена «есть/нужно», прочность, почему нельзя поставить.
  initBuildMenu() {
    const el = $('buildMenu');
    this.buildEl = el;
    this.buildTip = $('buildTip');
    this.buildIcons = {};
    el.innerHTML = `
      <div class="bm-head">
        <div class="bm-tabs"><kbd>Q</kbd>${BUILD_CATS.map((c, i) => `<div class="bm-tab" data-cat="${i}"><span>${c.icon}</span>${c.name}</div>`).join('')}<kbd>E</kbd></div>
        <div class="bm-tools">
          <div class="bm-tool" data-tool="repair" title="Чинить свои постройки"><span>🔧</span>Чинить<kbd>R</kbd></div>
          <div class="bm-tool" data-tool="demolish" title="Сносить свои постройки"><span>🧨</span>Снести<kbd>X</kbd></div>
        </div>
        <div class="bm-count" title="Сколько построек у вас стоит"></div>
        <div class="bm-close" data-tool="" title="Закрыть — B">✕</div>
      </div>
      <div class="bm-body"><div class="bm-cards"></div><div class="bm-info"></div></div>
      <div class="bm-foot"></div>`;
    this.bm = {
      tabs: [...el.querySelectorAll('.bm-tab')], tools: [...el.querySelectorAll('.bm-tool')],
      cards: el.querySelector('.bm-cards'), info: el.querySelector('.bm-info'), foot: el.querySelector('.bm-foot'), count: el.querySelector('.bm-count'),
    };
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const hit = (sel) => e.target.closest(sel);
      if (hit('[data-kind]')) this.onPickBuild?.(hit('[data-kind]').dataset.kind);
      else if (hit('[data-cat]')) this.onBuildCat?.(Number(hit('[data-cat]').dataset.cat));
      else if (hit('[data-tool]')) this.onBuildTool?.(hit('[data-tool]').dataset.tool || null);
    });
  }

  setBuildIcons(icons) {
    this.buildIcons = icons || {};
    this.cache.bmCards = null;
  }

  // подсказка у курсора в режиме стройки (html = null — убрать)
  setBuildTip(html, x = 0, y = 0) {
    const el = this.buildTip;
    if (!html) {
      if (this.cache.tip) {
        this.cache.tip = '';
        el.classList.add('hidden');
      }
      return;
    }
    if (this.cache.tip !== html) {
      this.cache.tip = html;
      el.innerHTML = html;
      el.classList.remove('hidden');
    }
    el.style.transform = `translate(${Math.round(x + 22)}px, ${Math.round(y + 20)}px)`;
  }

  // b: { mode: 'place' | 'repair' | 'demolish', kind, cat, reason, target, count, max, uid } или null
  updateBuildMenu(you, b) {
    const on = !!b;
    if (this.cache.bmOn !== on) {
      this.cache.bmOn = on;
      this.buildEl.classList.toggle('hidden', !on);
      this.buildEl.parentElement.classList.toggle('building', on);
    }
    if (!on) return;
    const { bm } = this;
    const has = new Set(you.ab || []);
    const inv = you.inv;
    const cat = BUILD_CATS[b.cat];
    const placing = b.mode === 'place';
    const head = `${b.mode}|${b.cat}|${b.count}`;
    if (this.cache.bmHead !== head) {
      this.cache.bmHead = head;
      bm.tabs.forEach((t, i) => t.classList.toggle('on', placing && i === b.cat));
      for (const t of bm.tools) t.classList.toggle('on', t.dataset.tool === b.mode);
      bm.count.innerHTML = `🏠 <b>${b.count}</b>/${b.max}`;
      bm.count.classList.toggle('full', b.count >= b.max);
      this.buildEl.dataset.mode = b.mode;
      bm.foot.innerHTML = placing
        ? '<span><kbd>ЛКМ</kbd> поставить</span><span>зажать <kbd>ЛКМ</kbd> и вести — ряд стен</span><span><kbd>1</kbd>–<kbd>9</kbd> постройка</span><span><kbd>ПКМ</kbd> / <kbd>B</kbd> выйти</span>'
        : `<span><kbd>ЛКМ</kbd> ${b.mode === 'repair' ? 'починить' : 'снести'} свою постройку под курсором</span><span><kbd>ПКМ</kbd> назад к стройке</span><span><kbd>B</kbd> выйти</span>`;
    }
    // карточки построек раздела
    const lack = (cost) => Object.entries(cost).some(([r, v]) => (inv[r] || 0) < v);
    const cards = cat.items.map((k) => `${k}${lack(STRUCTURES[k].cost) ? 'p' : ''}${STRUCTURES[k].ability && !has.has(STRUCTURES[k].ability) ? 'l' : ''}`).join(',') + `|${placing ? b.kind : ''}`;
    if (this.cache.bmCards !== cards) {
      this.cache.bmCards = cards;
      bm.cards.innerHTML = cat.items.map((k, i) => {
        const d = STRUCTURES[k];
        const locked = d.ability && !has.has(d.ability);
        const icon = this.buildIcons[k] ? `<img src="${this.buildIcons[k]}" alt="" draggable="false">` : '<div class="bm-noicon">🔨</div>';
        return `<div class="bm-card${placing && k === b.kind ? ' on' : ''}${lack(d.cost) ? ' poor' : ''}${locked ? ' locked' : ''}" data-kind="${k}">
          <kbd>${i + 1}</kbd>${locked ? '<div class="bm-lock">🔒</div>' : ''}${icon}
          <div class="bm-n">${d.name}</div><div class="bm-c">${costText(d.cost, inv)}</div></div>`;
      }).join('');
    }
    // справка справа
    const resRows = (cost, gain = false) => Object.entries(cost).map(([r, v]) => {
      const have = inv[r] || 0;
      return `<div class="bm-res ${gain || have >= v ? 'ok' : 'poor'}"><span>${ITEMS[r].icon}</span>${ITEMS[r].name}<b>${gain ? `+${v}` : `${have} / ${v}`}</b></div>`;
    }).join('');
    let info;
    if (placing) {
      const d = STRUCTURES[b.kind];
      const locked = d.ability && !has.has(d.ability);
      const state = locked ? `<div class="bm-state bad">🔒 Нужно умение «${ABILITIES[d.ability].name}» — путь разума (P)</div>`
        : b.reason ? `<div class="bm-state bad">✖ ${b.reason}</div>` : '<div class="bm-state good">✔ Можно ставить</div>';
      info = `<div class="bm-name">${d.name}</div><div class="bm-desc">${d.desc}</div>
        <div class="bm-stats"><span>❤ ${d.hp}</span><span>${d.mat === 'stone' ? '🪨 камень' : '🪵 дерево'}</span><span>${d.solid === true ? 'преграда' : d.solid === 'owner' ? 'проход только вам' : 'можно пройти'}</span></div>
        <div class="bm-reslist">${resRows(d.cost)}</div>${state}`;
    } else {
      const repair = b.mode === 'repair';
      const t = b.target;
      const title = repair ? '🔧 Ремонт' : '🧨 Снос';
      if (!t) {
        info = `<div class="bm-name">${title}</div><div class="bm-desc">${repair
          ? 'Наведите на свою повреждённую постройку. Ремонт до полной прочности стоит до половины её цены — по тому, сколько прочности утрачено.'
          : 'Наведите на свою постройку. За снос возвращается до половины ресурсов — по оставшейся прочности.'}</div>`;
      } else {
        const d = STRUCTURES[t.k];
        const mine = t.o === b.uid;
        const pct = Math.max(0, Math.min(100, Math.round((t.h / t.m) * 100)));
        const cost = repair ? repairCost(t.k, t.h, t.m) : demolishRefund(t.k, t.h, t.m);
        const any = Object.keys(cost).length > 0;
        const body = !mine ? `<div class="bm-state bad">✖ Чужая постройка (${t.on || '?'})</div>`
          : repair ? (any ? `<div class="bm-reslist">${resRows(cost)}</div>` : '<div class="bm-state good">✔ Постройка цела</div>')
            : `<div class="bm-reslist">${any ? resRows(cost, true) : ''}</div><div class="bm-state bad">Постройка будет разобрана</div>`;
        info = `<div class="bm-name">${title}: ${d.name}</div>
          <div class="bm-hp"><i style="width:${pct}%" class="${pct < 35 ? 'low' : pct < 70 ? 'mid' : ''}"></i><span>${t.h} / ${t.m}</span></div>${body}`;
      }
    }
    if (this.cache.bmInfo !== info) {
      this.cache.bmInfo = info;
      bm.info.innerHTML = info;
    }
  }

  // ---------- крафт ----------
  toggleCraft(on) {
    const show = on ?? this.craftEl.classList.contains('hidden');
    this.craftEl.classList.toggle('hidden', !show);
    this.cache.craft = null;
    return show;
  }

  // Окно крафта: вкладки, сетка карточек и справка по выбранному рецепту.
  // Базовые вкладки видны всем; «Технологии» — только пути разума, «Ритуалы» — только пути духа.
  initCraft() {
    this.craftTab = 'weapons';
    this.craftSel = 'club';
    const el = this.craftEl;
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    $('craftTabs').addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (!t) return;
      this.craftTab = t.dataset.tab;
      this.craftSel = CRAFT_TABS.find((c) => c.id === this.craftTab).items[0];
      this.cache.craft = null;
    });
    const grid = $('craftGrid');
    grid.addEventListener('click', (e) => {
      const c = e.target.closest('[data-item]');
      if (!c) return;
      this.craftSel = c.dataset.item;
      this.cache.craft = null;
    });
    grid.addEventListener('dblclick', (e) => {
      const c = e.target.closest('[data-item]');
      if (c) this.send({ t: 'craft', item: c.dataset.item });
    });
    $('craftInfo').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-n]');
      if (b && !b.disabled) this.send({ t: 'craft', item: this.craftSel, n: Number(b.dataset.n) });
    });
  }

  // почему рецепт сейчас не создать ('' — можно)
  craftBlock(you, k) {
    const rec = RECIPES[k];
    if (rec.ability && !(you.ab || []).includes(rec.ability)) return `Нужно умение «${ABILITIES[rec.ability].name}» (P)`;
    if (rec.bench && !you.bench) return 'Подойдите к верстаку';
    if (rec.lab && !you.lab) return 'Подойдите к лаборатории';
    if (rec.fire && !you.fire) return 'Ритуал проводят у костра';
    if (Object.entries(rec.cost).some(([r, v]) => (you.inv[r] || 0) < v)) return 'Не хватает ресурсов';
    return '';
  }

  renderCraft(you) {
    const sig = `${ITEM_KEYS.map((k) => you.inv[k] || 0).join(',')}|${you.bench}|${you.lab}|${you.fire}|${(you.ab || []).join(',')}|${you.pa}|${this.craftTab}|${this.craftSel}`;
    if (this.cache.craft === sig) return;
    this.cache.craft = sig;
    const tabs = CRAFT_TABS.filter((t) => !t.path || t.path === you.pa);
    let tab = tabs.find((t) => t.id === this.craftTab);
    if (!tab) {
      tab = tabs[0];
      this.craftTab = tab.id;
    }
    if (!tab.items.includes(this.craftSel)) this.craftSel = tab.items[0];
    const sel = this.craftSel;
    this.craftEl.dataset.path = tab.path || '';
    $('craftTabs').innerHTML = tabs.map((t) => `<div class="cr-tab${t === tab ? ' on' : ''}${t.path ? ` path-${t.path}` : ''}" data-tab="${t.id}"><span>${t.icon}</span>${t.name}</div>`).join('');
    // мастерские пути: что из них сейчас рядом
    const st = you.pa === 'mind' ? [['🔨', 'Верстак', you.bench], ['🔬', 'Лаборатория', you.lab]] : you.pa === 'spirit' ? [['🔥', 'Костёр', you.fire]] : [];
    $('craftStations').innerHTML = st.map(([ic, nm, on]) => `<div class="cr-st${on ? ' on' : ''}" title="${on ? 'Рядом' : 'Не рядом — подойдите или постройте (B)'}">${ic} ${nm}</div>`).join('');
    $('craftGrid').innerHTML = tab.items.map((k) => {
      const rec = RECIPES[k];
      const why = this.craftBlock(you, k);
      const locked = rec.ability && !(you.ab || []).includes(rec.ability);
      return `<div class="cr-card${k === sel ? ' on' : ''}${why ? ' no' : ''}${locked ? ' locked' : ''}" data-item="${k}">
        ${you.inv[k] ? `<div class="cr-have">${you.inv[k]}</div>` : ''}${locked ? '<div class="bm-lock">🔒</div>' : ''}
        <div class="cr-ic">${ITEMS[k].icon}</div><div class="cr-n">${ITEMS[k].name}${rec.out > 1 ? ` ×${rec.out}` : ''}</div>
        <div class="bm-c">${costText(rec.cost, you.inv)}</div></div>`;
    }).join('');
    // справка
    const rec = RECIPES[sel];
    const w = WEAPONS[sel];
    const chips = [];
    if (w) {
      chips.push(w.type === 'melee' ? '⚔ ближний бой' : w.type === 'throw' ? '💥 метательное' : '🎯 дальний бой');
      chips.push(`урон ${w.type === 'melee' ? '+' : ''}${w.dmg}${w.pellets ? `×${w.pellets}` : ''}`);
      chips.push(`удар раз в ${w.cd} с`);
      if (w.ammo) chips.push(`заряд: ${ITEMS[w.ammo].icon} ${ITEMS[w.ammo].name.toLowerCase()}`);
      if (w.mana) chips.push(`${w.mana} ✦ маны за выстрел`);
    } else chips.push(ITEMS[sel].kind === 'ammo' ? '🎒 боеприпас' : '🧴 расходник');
    const need = [];
    if (rec.bench) need.push(['🔨 Верстак рядом', you.bench]);
    if (rec.lab) need.push(['🔬 Лаборатория рядом', you.lab]);
    if (rec.fire) need.push(['🔥 Костёр рядом', you.fire]);
    if (rec.ability) need.push([`${ABILITIES[rec.ability].icon} Умение «${ABILITIES[rec.ability].name}»`, (you.ab || []).includes(rec.ability)]);
    const why = this.craftBlock(you, sel);
    let max = CRAFT_MAX;
    for (const [r, v] of Object.entries(rec.cost)) max = Math.min(max, Math.floor((you.inv[r] || 0) / v));
    const many = !w && max > 1; // оружие делают по одному, припасы — пачкой
    $('craftInfo').innerHTML = `
      <div class="cr-big">${ITEMS[sel].icon}</div>
      <div class="bm-name">${ITEMS[sel].name}${rec.out > 1 ? ` ×${rec.out}` : ''}</div>
      <div class="bm-desc">${w ? w.desc : RECIPE_DESC[sel] || ''}</div>
      <div class="bm-stats">${chips.map((c) => `<span>${c}</span>`).join('')}</div>
      ${need.length ? `<div class="cr-need">${need.map(([t, ok]) => `<div class="${ok ? 'ok' : 'poor'}">${ok ? '✔' : '✖'} ${t}</div>`).join('')}</div>` : ''}
      <div class="bm-reslist">${Object.entries(rec.cost).map(([r, v]) => {
    const have = you.inv[r] || 0;
    return `<div class="bm-res ${have >= v ? 'ok' : 'poor'}"><span>${ITEMS[r].icon}</span>${ITEMS[r].name}<b>${have} / ${v}</b></div>`;
  }).join('')}</div>
      <div class="cr-actions">
        <button class="primary" data-n="1" ${why ? 'disabled' : ''}>Создать</button>
        ${many ? `<button data-n="${max}">×${max}</button>` : ''}
      </div>
      <div class="bm-state ${why ? 'bad' : 'good'}">${why ? `✖ ${why}` : `✔ Можно создать${you.inv[sel] ? ` · у вас ${you.inv[sel]}` : ''}`}</div>`;
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

  // Мини-карта: окрестности игрока (MINI_SPAN единиц), за краем — стрелки к палатке, метеориту и метке
  drawMinimap(me, face, nest, meteor, myStructures, t) {
    this.lastMap = { me, face, nest, meteor, myStructures };
    if (!me) return;
    const W = this.minimap.width;
    const span = MINI_SPAN;
    const x0 = me.x - span / 2;
    const y0 = me.y - span / 2;
    this.drawMap(this.mctx, W, x0, y0, span, { me, face, nest, meteor, myStructures, t, edge: true });
    if (this.bigOpen) this.drawBigMap(t);
  }

  // Общая отрисовка карты: span единиц мира по ширине W, начиная с (x0, y0), в прямоугольник W×H.
  // big — большая карта: крупнее значки, заметная отметка игрока, расстояние до метки
  drawMap(g, W, x0, y0, span, { me, face, nest, meteor, myStructures, t, edge = false, iconSize = 10, big = false, H = W }) {
    const s = W / span;
    const px = (x) => (x - x0) * s;
    const py = (y) => (y - y0) * s;
    g.fillStyle = '#1b4f63';
    g.fillRect(0, 0, W, H);
    // вблизи (больше пары пикселей на клетку) — сглаживаем, издалека — чёткие клетки
    g.imageSmoothingEnabled = s * TILE > 2.5;
    if (this.mapBase) g.drawImage(this.mapBase, x0 / TILE, y0 / TILE, span / TILE, H / s / TILE, 0, 0, W, H);
    g.fillStyle = '#ffffff';
    const sq = big ? Math.max(2.5, s * TILE * 0.8) : 2.5;
    for (const st of myStructures || []) g.fillRect(px(st.x) - sq / 2, py(st.y) - sq / 2, sq, sq);
    g.font = `${iconSize}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const z of this.zones) {
      const zx = px(z.x);
      const zy = py(z.y);
      if (zx < -20 || zy < -20 || zx > W + 20 || zy > H + 20) continue;
      if (z.kind === 'city') continue; // город виден по клеткам, в его центре — значок воронки
      g.fillStyle = '#1d1d1f';
      g.fillText(SITES[z.kind]?.icon || '☢', zx, zy);
    }
    // точка на краю карты по направлению к цели, если сама цель за краем
    const clampEdge = (x, y) => {
      const cx = W / 2;
      const cy = H / 2;
      const dx = x - cx;
      const dy = y - cy;
      const m = Math.max(Math.abs(dx) / (cx - 8), Math.abs(dy) / (cy - 8));
      if (m <= 1) return [x, y, false];
      return [cx + dx / m, cy + dy / m, true];
    };
    const k = big ? 1.6 : 1;
    if (nest) {
      let [nx, ny, out] = [px(nest[0]), py(nest[1]), false];
      if (edge) [nx, ny, out] = clampEdge(nx, ny);
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.arc(nx, ny, (out ? 3 : 3.5) * k, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.stroke();
    }
    if (meteor) {
      let [mx, my, out] = [px(meteor.x), py(meteor.y), false];
      if (edge) [mx, my, out] = clampEdge(mx, my);
      g.strokeStyle = '#c77dff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(mx, my, ((out ? 3 : 5) + Math.sin(t * 5) * 2) * k, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#c77dff';
      g.fillRect(mx - 1.5, my - 1.5, 3, 3);
    }
    // метка игрока: красный флажок-капля; на краю мини-карты — стрелка в её сторону
    if (this.marker) {
      let [mx, my, out] = [px(this.marker.x), py(this.marker.y), false];
      if (edge) [mx, my, out] = clampEdge(mx, my);
      const r = (out ? 4 : 6) * k;
      g.fillStyle = '#ff5a3c';
      g.strokeStyle = '#1a0a06';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(mx, my);
      g.lineTo(mx - r * 0.8, my - r * 1.6);
      g.arc(mx, my - r * 1.9, r * 0.85, Math.PI * 0.85, Math.PI * 0.15);
      g.closePath();
      g.fill();
      g.stroke();
      if (big && me) {
        const dist = Math.hypot(this.marker.x - me.x, this.marker.y - me.y) / 24; // 24 ед. ≈ 1 м
        g.font = 'bold 12px sans-serif';
        g.fillStyle = '#fff';
        g.strokeStyle = 'rgba(0,0,0,0.75)';
        g.lineWidth = 3;
        const txt = dist >= 1000 ? `${(dist / 1000).toFixed(1)} км` : `${Math.round(dist)} м`;
        g.strokeText(txt, mx, my - r * 3.4);
        g.fillText(txt, mx, my - r * 3.4);
      }
    }
    if (me) {
      const ex = px(me.x);
      const ey = py(me.y);
      if (big) {
        // на большой карте себя видно сразу: пульсирующее кольцо и подпись
        const pulse = (t * 0.9) % 1;
        g.strokeStyle = `rgba(156, 240, 164, ${1 - pulse})`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(ex, ey, 10 + pulse * 26, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = 'rgba(11, 16, 22, 0.55)';
        g.beginPath();
        g.arc(ex, ey, 12, 0, Math.PI * 2);
        g.fill();
      }
      g.save();
      g.translate(ex, ey);
      g.rotate(face);
      g.scale(k * (big ? 1.25 : 1), k * (big ? 1.25 : 1));
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
      if (big) {
        g.font = 'bold 12px sans-serif';
        g.fillStyle = '#9cf0a4';
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.lineWidth = 3;
        g.strokeText('Вы', ex, ey + 24);
        g.fillText('Вы', ex, ey + 24);
      }
    }
  }

  // ---------- большая карта (N или щелчок по мини-карте) ----------
  // колесо — масштаб к курсору, перетаскивание — сдвиг, щелчок — метка, ПКМ — убрать метку
  initBigMap() {
    const c = $('bigmapCanvas');
    // span — сколько единиц мира помещается по короткой стороне окна карты
    this.bigView = { cx: WORLD / 2, cy: WORLD / 2, span: 14000 };
    const toWorld = (e) => {
      const r = c.getBoundingClientRect();
      const v = this.bigView;
      const u = this.bigUnit();
      return [v.cx + (e.clientX - r.left - r.width / 2) * u, v.cy + (e.clientY - r.top - r.height / 2) * u];
    };
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const v = this.bigView;
      const [wx, wy] = toWorld(e);
      const span = Math.max(1600, Math.min(WORLD * 1.05, v.span * (e.deltaY > 0 ? 1.18 : 1 / 1.18)));
      // точка под курсором остаётся на месте
      v.cx = wx - (wx - v.cx) * (span / v.span);
      v.cy = wy - (wy - v.cy) * (span / v.span);
      v.span = span;
      this.clampBigView();
      this.drawBigMap(performance.now() / 1000);
    }, { passive: false });
    let drag = null;
    c.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (e.button === 2) return;
      drag = { x: e.clientX, y: e.clientY, cx: this.bigView.cx, cy: this.bigView.cy, moved: false };
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      c.classList.add('drag');
      const u = this.bigUnit();
      this.bigView.cx = drag.cx - dx * u;
      this.bigView.cy = drag.cy - dy * u;
      this.clampBigView();
      this.drawBigMap(performance.now() / 1000);
    });
    window.addEventListener('mouseup', (e) => {
      if (!drag) return;
      const wasDrag = drag.moved;
      drag = null;
      c.classList.remove('drag');
      if (!wasDrag && e.target === c) {
        const [wx, wy] = toWorld(e);
        this.onMarker?.({ x: Math.round(wx), y: Math.round(wy) });
      }
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onMarker?.(null);
    });
    $('bigmap').addEventListener('mousedown', (e) => {
      if (e.target.id === 'bigmap') this.toggleBigMap(false); // щелчок мимо карты — закрыть
    });
    $('bigmapClose').addEventListener('click', () => this.toggleBigMap(false));
    $('bigmapUnmark').addEventListener('click', () => this.onMarker?.(null));
    $('bigmapMe').addEventListener('click', () => this.centerBigMap());
  }

  // размер окна карты в CSS-пикселях и сколько единиц мира приходится на пиксель
  bigSize() {
    const wrap = $('bigmapCanvas').parentElement;
    return [wrap.clientWidth || 1, wrap.clientHeight || 1];
  }

  bigUnit() {
    const [W, H] = this.bigSize();
    return this.bigView.span / Math.min(W, H);
  }

  // не даём увести остров за край: если он целиком влезает по оси — держим по центру
  clampBigView() {
    const v = this.bigView;
    const [W, H] = this.bigSize();
    const u = this.bigUnit();
    const hx = (W * u) / 2;
    const hy = (H * u) / 2;
    v.cx = Math.max(Math.min(hx, WORLD / 2), Math.min(Math.max(WORLD - hx, WORLD / 2), v.cx));
    v.cy = Math.max(Math.min(hy, WORLD / 2), Math.min(Math.max(WORLD - hy, WORLD / 2), v.cy));
  }

  centerBigMap() {
    const me = this.lastMap?.me;
    if (me) {
      this.bigView.cx = me.x;
      this.bigView.cy = me.y;
      this.clampBigView();
    }
    this.drawBigMap(performance.now() / 1000);
  }

  setMarker(m) {
    this.marker = m;
    if (this.bigOpen) this.drawBigMap(performance.now() / 1000);
  }

  toggleBigMap(force) {
    this.bigOpen = force ?? !this.bigOpen;
    $('bigmap').classList.toggle('hidden', !this.bigOpen);
    if (this.bigOpen) this.centerBigMap(); // открывается вокруг игрока
  }

  // Окно карты занимает почти весь экран; холст — в физических пикселях, чтобы на HiDPI не мылилось
  drawBigMap(t) {
    const c = $('bigmapCanvas');
    const [W, H] = this.bigSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(W * dpr);
    const bh = Math.round(H * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
      this.clampBigView(); // окно изменилось — остров не должен уехать за край
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = this.bigView;
    const u = this.bigUnit();
    const m = this.lastMap || {};
    const icon = Math.round(Math.max(12, Math.min(24, 12 * Math.sqrt(16000 / v.span))));
    this.drawMap(g, W, v.cx - (W * u) / 2, v.cy - (H * u) / 2, W * u, { ...m, t, iconSize: icon, big: true, H });
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
      row.innerHTML = `<span>${isDna ? '☣' : ITEMS[k].icon}</span><span>${isDna ? 'Мутаген' : ITEMS[k].name}<br><span class="cnt">${mine} → ${inside}</span></span>`;
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
