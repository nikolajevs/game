// Редактор мутаций: две школы — импланты (технологические) и дары плоти (духовные).
// Тратим мутаген и материалы школы на изменения тела, видим результат в 3D.
import { PARTS, PART_KEYS, LEVEL_COST, COMPLEXITY_CAP, VIEW_MULT, ABILITIES, MUT_SCHOOLS, SCHOOL_KEYS, PATHS, ITEMS, APEX_LEVEL } from '/shared/config.js';
import { decodeGenome, encodeGenome, cloneGenome, evolveCostWith, complexity, computeStats, schoolLevels, levelLimit, overLimit } from '/shared/creature.js';
import { CreaturePreview } from './creature-preview.js';

const $ = (id) => document.getElementById(id);
const pct = (v) => Math.round(v * 100);

const STAT_ROWS = [
  ['Здоровье', (s) => s.maxHp, ''],
  ['Урон телом', (s) => s.meleeDmg, ''],
  ['Урон оружием', (s) => pct(s.wpnMul * s.armMul), '%'],
  ['Удар раз в', (s) => pct(s.cdMul), '% времени', true],
  ['Скорость', (s) => s.speed, ''],
  ['Обзор', (s) => Math.round(s.vision * VIEW_MULT), ''],
  ['Защита', (s) => pct(s.defense), '%'],
  ['Отражение', (s) => pct(s.thorns), '%'],
  ['Кислота', (s) => (s.spit ? s.spit.dmg : 0), ''],
  ['Таран', (s) => (s.charge ? s.charge.dmg : 0), ''],
  ['Рывок', (s) => (s.dash ? s.dash.dist : 0), ''],
  ['Лечение', (s) => pct(s.regen), '%'],
  ['Восстановление сил', (s) => pct(s.staRegen), '%'],
  ['Радиозащита', (s) => pct(s.radResist), '%'],
  ['Расход пищи', (s) => pct(s.metabolism), '%', true],
];
const costHtml = (items) => Object.entries(items || {}).map(([k, v]) => ` +${v}${ITEMS[k].icon}`).join('');

export class Editor {
  constructor(send) {
    this.send = send;
    this.root = $('editor');
    this.preview = null;
    this.isOpen = false;
    this.ap = null; // внешность своего персонажа — для превью
    this.school = 'tech'; // открытая вкладка школы
    $('edSchools').addEventListener('click', (e) => {
      const t = e.target.closest('[data-school]');
      if (!t) return;
      this.school = t.dataset.school;
      this.render();
    });
    $('edClose').addEventListener('click', () => this.close());
    $('edReset').addEventListener('click', () => {
      this.draft = cloneGenome(this.base);
      this.render();
    });
    $('edApply').addEventListener('click', () => {
      this.send({ t: 'evolve', genome: this.draft });
    });
  }

  open(you) {
    this.you = you;
    this.base = decodeGenome(you.g);
    this.draft = cloneGenome(this.base);
    this.color = you.c;
    this.isOpen = true;
    this.root.classList.remove('hidden');
    if (!this.preview) this.preview = new CreaturePreview($('edPreview'));
    this.preview.start();
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.preview?.stop();
    this.onClose?.();
  }

  // свежий мутаген/кристаллы/бой без сброса черновика
  refresh(you) {
    if (!this.isOpen) return;
    const prev = this.you;
    this.you = you;
    if (you.g !== prev.g) {
      this.base = decodeGenome(you.g);
      this.draft = cloneGenome(this.base);
      this.render();
      return;
    }
    if (prev.pa !== you.pa) return this.render();
    if (prev.dna !== you.dna || prev.cb !== you.cb || ['crystal', 'scrap', 'electronics', 'bone'].some((k) => prev.inv[k] !== you.inv[k])) this.renderFooter();
  }

  setPart(k, delta) {
    const v = this.draft.parts[k] + delta;
    if (v < 0 || v > PARTS[k].max) return;
    if (delta > 0 && v > Math.max(levelLimit(k, this.you.pa), this.base.parts[k])) return;
    this.draft.parts[k] = v;
    this.render();
  }

  render() {
    this.preview.set(encodeGenome(this.draft), this.color, this.ap || 'm.0.1.0.0');
    const gen = (this.you.ab || []).includes('genetics');
    const path = this.you.pa;
    const lv = schoolLevels(this.draft);
    const was = schoolLevels(this.base);
    // вкладки школ
    $('edSchools').innerHTML = SCHOOL_KEYS.map((id) => {
      const S = MUT_SCHOOLS[id];
      return `<div class="ed-school${id === this.school ? ' on' : ''}" data-school="${id}" style="--sc:${S.color}">
        <span class="es-ic">${S.icon}</span><span><b>${S.name}</b><em>${S.full}</em></span>
        <span class="es-n${lv[id] !== was[id] ? ' ch' : ''}">${lv[id]}</span></div>`;
    }).join('');
    // о школе: чей путь доводит до предела, резонанс, чем платить
    const S = MUT_SCHOOLS[this.school];
    const own = S.path === path;
    const n = lv[this.school];
    const pay = [...new Set(S.item.flatMap((it) => Object.keys(it || {})))].map((k) => `${ITEMS[k].icon} ${ITEMS[k].name.toLowerCase()}`).join(', ');
    const info = $('edSchoolInfo');
    info.style.setProperty('--sc', S.color);
    info.innerHTML = `<div class="esi-desc">${S.desc}</div>
      <div class="esi-res">${S.res.map((r) => `<span class="${n >= r.need ? 'on' : ''}" title="Резонанс школы: наберите в ней ${r.need} уровней">◆ ${r.name} <i>${Math.min(n, r.need)}/${r.need}</i> — ${r.desc}</span>`).join('')}</div>
      <div class="esi-note ${own ? 'ok' : ''}">${own ? `★ Ваш путь: мутации этой школы растут до предела — ${APEX_LEVEL}-го уровня`
    : `🔒 Предел (${APEX_LEVEL}-й уровень) откроет ${PATHS[S.path].icon} ${PATHS[S.path].name.toLowerCase()}${path ? ' — вы выбрали другой путь' : ' (P)'}`}</div>
      <div class="esi-note">Цена: мутаген ☣${pay ? ` и ${pay}` : ''}${gen ? ' · 🧬 генная инженерия: только мутаген, на 30% дешевле' : ''}</div>`;
    // мутации школы
    const parts = $('edParts');
    parts.innerHTML = '';
    for (const k of PART_KEYS) {
      const def = PARTS[k];
      if (def.school !== this.school) continue;
      const cur = this.draft.parts[k];
      const base = this.base.parts[k];
      const limit = Math.max(levelLimit(k, path), base);
      const row = document.createElement('div');
      row.className = `prow${cur !== base ? ' changed' : ''}`;
      row.style.setProperty('--sc', S.color);
      let pips = '';
      for (let i = 1; i <= def.max; i++) {
        let cls = '';
        if (i <= Math.min(cur, base)) cls = 'on';
        else if (i <= cur) cls = 'new';
        else if (i <= base) cls = 'lost';
        else if (i > limit) cls = 'locked';
        pips += `<div class="pip ${cls}${i === APEX_LEVEL && def.apex ? ' apex' : ''}"></div>`;
      }
      let next = 'макс.';
      if (cur < limit) {
        const dna = gen ? Math.ceil(LEVEL_COST[cur + 1] * ABILITIES.genetics.priceMul) : LEVEL_COST[cur + 1];
        next = `${dna}☣${gen ? '' : costHtml(S.item[cur + 1])}`;
      } else if (cur < def.max) next = '🔒';
      const apex = def.apex ? `<div class="pa${cur >= APEX_LEVEL ? ' on' : ''}${limit < APEX_LEVEL ? ' locked' : ''}">★ Предел: ${def.apex}</div>` : '';
      row.innerHTML = `<div class="pi">${def.icon}</div><div><div class="pn">${def.name}</div><div class="pd">${def.desc}</div>${apex}</div><div class="pips">${pips}</div>`;
      const minus = document.createElement('button');
      minus.textContent = '−';
      minus.disabled = cur <= 0;
      minus.addEventListener('click', () => this.setPart(k, -1));
      const plus = document.createElement('button');
      plus.textContent = '+';
      plus.disabled = cur >= limit;
      if (cur >= limit && cur < def.max) plus.title = `Предел откроет ${PATHS[S.path].name.toLowerCase()}`;
      plus.addEventListener('click', () => this.setPart(k, 1));
      const btns = document.createElement('div');
      btns.className = 'row';
      btns.style.gap = '4px';
      btns.append(minus, plus);
      const pc = document.createElement('div');
      pc.className = 'pc';
      pc.innerHTML = next;
      row.append(btns, pc);
      parts.appendChild(row);
    }
    this.renderStats();
    this.renderFooter();
  }

  renderStats() {
    const a = computeStats(this.base);
    const b = computeStats(this.draft);
    $('edStats').innerHTML = STAT_ROWS.map(([name, fn, unit, lowerBetter]) => {
      const va = fn(a);
      const vb = fn(b);
      let cls = '';
      if (vb !== va) cls = (vb > va) !== !!lowerBetter ? 'up' : 'down';
      const val = vb !== va ? `${va}${unit} → <span class="${cls}">${vb}${unit}</span>` : `${vb}${unit}`;
      return `<div class="srow"><span>${name}</span><span>${val}</span></div>`;
    }).join('');
  }

  renderFooter() {
    const you = this.you;
    // «Генная инженерия» (путь разума): предел выше, мутации дешевле, 3-й уровень без кристаллов
    const genetics = (you.ab || []).includes('genetics');
    const cap = COMPLEXITY_CAP + (genetics ? ABILITIES.genetics.cap : 0);
    const cx = complexity(this.draft);
    const cxEl = $('edComplexity');
    cxEl.innerHTML = `сложность <b>${cx}/${cap}</b>${genetics ? ' 🧬' : ''}`;
    cxEl.classList.toggle('over', cx > cap);
    const c = evolveCostWith(this.base, this.draft, genetics);
    const changed = encodeGenome(this.base) !== encodeGenome(this.draft);
    const parts = [];
    const poorDna = c.net > you.dna;
    const poor = Object.keys(c.items).filter((k) => (you.inv[k] || 0) < c.items[k]);
    if (c.net >= 0) parts.push(`<span class="${poorDna ? 'bad' : ''}">Цена: ${c.net} ☣</span>`);
    else parts.push(`Возврат: ${-c.net} ☣`);
    for (const [k, v] of Object.entries(c.items)) parts.push(`<span class="${poor.includes(k) ? 'bad' : ''}">${v} ${ITEMS[k].icon}</span>`);
    const have = ['crystal', 'scrap', 'electronics', 'bone'].filter((k) => c.items[k]).map((k) => `, ${you.inv[k] || 0} ${ITEMS[k].icon}`).join('');
    parts.push(`<span class="muted">· у вас ${you.dna} ☣${have}</span>`);
    let reason = '';
    if (you.cb) reason = 'В бою мутировать нельзя';
    else if (cx > cap) reason = 'Тело не выдержит столько мутаций';
    else if (overLimit(this.base, this.draft, you.pa).length) reason = 'Предел мутации открывает только свой путь';
    else if (poorDna) reason = 'Не хватает мутагена — побудьте в радиации';
    else if (poor.length) reason = `Не хватает: ${poor.map((k) => ITEMS[k].name.toLowerCase()).join(', ')}`;
    $('edCost').innerHTML = parts.join(' ') + (reason && changed ? `<div class="bad small">${reason}</div>` : '');
    $('edApply').disabled = !changed || !!reason;
  }
}
