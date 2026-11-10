// Окно путей развития (P): путь разума и путь духа, их умения, очки, лаборатория и артефакты.
import { PATHS, ABILITIES, ABILITY_ORDER, TIER_NEED, KNOW_GAIN, SPIRIT_GAIN, ITEMS, NPCS } from '/shared/config.js';

const $ = (id) => document.getElementById(id);
const TIER_NAMES = ['', 'Ступень I', 'Ступень II', 'Ступень III'];
const KIND_NAMES = { passive: 'всегда действует', unlock: 'открывает', spell: 'заклинание — в поясе, ЛКМ', instant: 'мгновенно — цифрой из пояса' };

export class PathsWindow {
  constructor(send) {
    this.send = send;
    this.root = $('paths');
    this.body = $('pathsBody');
    this.isOpen = false;
    this.confirm = null; // умение, которое выберет путь, — ждёт второго нажатия
    this.confirmReset = false;
    $('pathsClose').addEventListener('click', () => this.close());
    // клики по кнопкам внутри окна (разметка перерисовывается)
    this.body.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'learn') this.onLearn(b.dataset.id);
      else if (act === 'reset') this.onReset();
      else if (act === 'data' || act === 'experiment') this.send({ t: 'research', kind: act });
      else if (act === 'absorb') this.send({ t: 'absorb' });
    });
  }

  open(you) {
    this.isOpen = true;
    this.confirm = null;
    this.confirmReset = false;
    this.root.classList.remove('hidden');
    this.sig = '';
    this.refresh(you);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  onLearn(id) {
    const you = this.you;
    if (!you.pa && this.confirm !== id) {
      // первое умение выбирает путь навсегда — переспросим
      this.confirm = id;
      this.sig = '';
      this.refresh(you);
      return;
    }
    this.confirm = null;
    this.send({ t: 'learn', id });
  }

  onReset() {
    if (!this.confirmReset) {
      this.confirmReset = true;
      this.sig = '';
      this.refresh(this.you);
      return;
    }
    this.confirmReset = false;
    this.send({ t: 'resetPath' });
  }

  refresh(you) {
    if (!this.isOpen || !you) return;
    this.you = you;
    const sig = JSON.stringify([you.pa, you.kn, you.spi, you.ab, you.lab, you.inv.data, you.inv.artifact, you.inv.scrap, you.inv.crystal, this.confirm, this.confirmReset]);
    if (sig === this.sig) return;
    this.sig = sig;
    const learned = new Set(you.ab || []);
    const spent = { mind: 0, spirit: 0 };
    for (const id of learned) spent[ABILITIES[id].path] += ABILITIES[id].cost;
    const pts = { mind: you.kn || 0, spirit: you.spi || 0 };
    let html = '';
    // шапка
    html += '<div class="paths-top">';
    if (you.pa) {
      const P = PATHS[you.pa];
      html += `<div class="paths-chosen" style="--pc:${P.color}">${P.icon} Ваш путь: <b>${P.name}</b></div>`;
      html += `<button data-act="reset" class="${this.confirmReset ? 'danger' : ''}">${this.confirmReset ? 'Точно? Все умения пути пропадут — нажмите ещё раз' : 'Сменить путь (полный сброс)'}</button>`;
    } else {
      html += '<div class="paths-chosen muted">Путь ещё не выбран. Первое изученное умение выберет путь <b>навсегда</b> — другой закроется.</div>';
    }
    html += '</div><div class="paths-cols">';
    for (const pathId of ['mind', 'spirit']) {
      const P = PATHS[pathId];
      const closed = you.pa && you.pa !== pathId;
      html += `<div class="path-col ${closed ? 'closed' : ''}" style="--pc:${P.color}">`;
      html += `<div class="path-head"><div class="path-name">${P.icon} ${P.name}</div><div class="path-pts">${P.ptIcon} <b>${pts[pathId]}</b> ${P.ptName.toLowerCase()}</div></div>`;
      html += `<div class="path-desc">${P.desc}</div><div class="path-how">${P.how}</div>`;
      // способы получить очки
      if (pathId === 'mind') {
        const n = you.inv.data || 0;
        const ex = KNOW_GAIN.experiment;
        const canEx = Object.entries(ex.cost).every(([k, v]) => (you.inv[k] || 0) >= v);
        const block = you.pa === 'spirit';
        html += '<div class="path-acts">';
        if (!you.lab) html += '<div class="muted small">🔬 Подойдите к лаборатории (постройка B), чтобы изучать данные и ставить опыты</div>';
        html += `<button data-act="data" ${!you.lab || !n || block ? 'disabled' : ''}>💾 Изучить данные ×${n} → +${n * KNOW_GAIN.data} 📘</button>`;
        html += `<button data-act="experiment" ${!you.lab || !canEx || block ? 'disabled' : ''}>⚗ Опыт: ${ex.cost.scrap}${ITEMS.scrap.icon} + ${ex.cost.crystal}${ITEMS.crystal.icon} → +${ex.gain} 📘</button>`;
        html += '</div>';
      } else {
        const n = you.inv.artifact || 0;
        const block = you.pa === 'mind';
        html += '<div class="path-acts">';
        html += `<button data-act="absorb" ${!n || block ? 'disabled' : ''}>🔮 Поглотить артефакты ×${n} → +${n * SPIRIT_GAIN.artifact} ✨</button>`;
        html += `<div class="muted small">🕯 У алтаря стойте неподвижно — медитация даёт силу духа (у каждого алтаря свой запас). Победы над духами и мутантами леса тоже дают силу: от +${NPCS.crooked.spirit} ✨ за горбуна до +${NPCS.glutton.spirit} ✨ за утробника</div>`;
        html += '</div>';
      }
      // ступени и умения
      for (let tier = 1; tier <= 3; tier++) {
        const open = spent[pathId] >= TIER_NEED[tier];
        html += `<div class="tier"><div class="tier-name">${TIER_NAMES[tier]}${TIER_NEED[tier] && !open ? ` <span class="muted">— вложите ${TIER_NEED[tier]} очков</span>` : ''}</div><div class="tier-row">`;
        for (const id of ABILITY_ORDER) {
          const ab = ABILITIES[id];
          if (ab.path !== pathId || ab.tier !== tier) continue;
          const has = learned.has(id);
          let btn = '';
          if (has) btn = '<div class="ab-done">✓ Изучено</div>';
          else if (closed) btn = '<div class="ab-lock">Путь закрыт</div>';
          else {
            const poor = pts[pathId] < ab.cost;
            const confirm = this.confirm === id;
            const label = confirm ? `Выбрать ${P.name.toLowerCase()} навсегда?` : `Изучить · ${ab.cost} ${P.ptIcon}`;
            btn = `<button data-act="learn" data-id="${id}" class="${confirm ? 'danger' : ''}" ${!open || poor ? 'disabled' : ''} title="${!open ? 'Сначала нижние ступени' : poor ? `Нужно ${ab.cost} ${P.ptName.toLowerCase()}` : ''}">${label}</button>`;
          }
          const extra = ab.mana ? ` · ${ab.mana} маны` : '';
          const cd = ab.cd && ab.kind !== 'passive' ? ` · перезарядка ${ab.cd} с` : '';
          html += `<div class="ab-card ${has ? 'has' : ''}">
            <div class="ab-ic">${ab.icon}</div>
            <div class="ab-main"><div class="ab-name">${ab.name}</div><div class="ab-desc">${ab.desc}</div>
            <div class="ab-kind">${KIND_NAMES[ab.kind]}${extra}${cd}</div></div>
            <div class="ab-btn">${btn}</div></div>`;
        }
        html += '</div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
    this.body.innerHTML = html;
  }
}
