// Редактор мутаций: тратим мутаген (и кристаллы) на изменения тела, видим результат в 3D.
import { PARTS, PART_KEYS, LEVEL_COST, LEVEL3_CRYSTALS, COMPLEXITY_CAP, VIEW_MULT } from '/shared/config.js';
import { decodeGenome, encodeGenome, cloneGenome, evolveCost, complexity, computeStats } from '/shared/creature.js';
import { CreaturePreview } from './creature-preview.js';

const $ = (id) => document.getElementById(id);

const STAT_ROWS = [
  ['Здоровье', (s) => s.maxHp, ''],
  ['Урон', (s) => s.meleeDmg, ''],
  ['Скорость', (s) => s.speed, ''],
  ['Обзор', (s) => Math.round(s.vision * VIEW_MULT), ''],
  ['Защита', (s) => Math.round(s.defense * 100), '%'],
  ['Отражение', (s) => Math.round(s.thorns * 100), '%'],
  ['Кислота', (s) => (s.spit ? s.spit.dmg : 0), ''],
  ['Таран', (s) => (s.charge ? s.charge.dmg : 0), ''],
  ['Плавание', (s) => s.swim, ''],
  ['Радиозащита', (s) => Math.round(s.radResist * 100), '%'],
  ['Расход пищи', (s) => Math.round(s.metabolism * 100), '%', true],
];

export class Editor {
  constructor(send) {
    this.send = send;
    this.root = $('editor');
    this.preview = null;
    this.isOpen = false;
    this.ap = null; // внешность своего персонажа — для превью
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
    if (prev.dna !== you.dna || prev.inv.crystal !== you.inv.crystal || prev.cb !== you.cb) this.renderFooter();
  }

  setPart(k, delta) {
    const v = this.draft.parts[k] + delta;
    if (v < 0 || v > PARTS[k].max) return;
    this.draft.parts[k] = v;
    this.render();
  }

  render() {
    this.preview.set(encodeGenome(this.draft), this.color, this.ap || 'm.0.1.0.0');
    // мутации
    const parts = $('edParts');
    parts.innerHTML = '';
    for (const k of PART_KEYS) {
      const def = PARTS[k];
      const lv = this.draft.parts[k];
      const was = this.base.parts[k];
      const row = document.createElement('div');
      row.className = `prow${lv !== was ? ' changed' : ''}`;
      let pips = '';
      for (let i = 1; i <= def.max; i++) {
        let cls = '';
        if (i <= Math.min(lv, was)) cls = 'on';
        else if (i <= lv) cls = 'new';
        else if (i <= was) cls = 'lost';
        pips += `<div class="pip ${cls}"></div>`;
      }
      const next = lv < def.max ? `${LEVEL_COST[lv + 1]}☣${lv + 1 >= 3 ? ` +${LEVEL3_CRYSTALS}💎` : ''}` : 'макс.';
      row.innerHTML = `<div class="pi">${def.icon}</div><div><div class="pn">${def.name}</div><div class="pd">${def.desc}</div></div><div class="pips">${pips}</div>`;
      const minus = document.createElement('button');
      minus.textContent = '−';
      minus.disabled = lv <= 0;
      minus.addEventListener('click', () => this.setPart(k, -1));
      const plus = document.createElement('button');
      plus.textContent = '+';
      plus.disabled = lv >= def.max;
      plus.addEventListener('click', () => this.setPart(k, 1));
      const btns = document.createElement('div');
      btns.className = 'row';
      btns.style.gap = '4px';
      btns.append(minus, plus);
      const pc = document.createElement('div');
      pc.className = 'pc';
      pc.textContent = next;
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
    const cx = complexity(this.draft);
    const cxEl = $('edComplexity');
    cxEl.innerHTML = `сложность <b>${cx}/${COMPLEXITY_CAP}</b>`;
    cxEl.classList.toggle('over', cx > COMPLEXITY_CAP);
    const c = evolveCost(this.base, this.draft);
    const you = this.you;
    const changed = encodeGenome(this.base) !== encodeGenome(this.draft);
    const parts = [];
    const poorDna = c.net > you.dna;
    const poorCr = c.crystals > you.inv.crystal;
    if (c.net >= 0) parts.push(`<span class="${poorDna ? 'bad' : ''}">Цена: ${c.net} ☣</span>`);
    else parts.push(`Возврат: ${-c.net} ☣`);
    if (c.crystals) parts.push(`<span class="${poorCr ? 'bad' : ''}">${c.crystals} 💎</span>`);
    parts.push(`<span class="muted">· у вас ${you.dna} ☣, ${you.inv.crystal} 💎</span>`);
    let reason = '';
    if (you.cb) reason = 'В бою мутировать нельзя';
    else if (cx > COMPLEXITY_CAP) reason = 'Тело не выдержит столько мутаций';
    else if (poorDna) reason = 'Не хватает мутагена — побудьте в радиации';
    else if (poorCr) reason = 'Нужны кристаллы мутагена (метеориты, колоссы, ящики в зонах)';
    $('edCost').innerHTML = parts.join(' ') + (reason && changed ? `<div class="bad small">${reason}</div>` : '');
    $('edApply').disabled = !changed || !!reason;
  }
}
