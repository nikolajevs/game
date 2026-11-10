// Окно путей развития (P). Пока путь не выбран — две большие карты с картинами: путь разума и путь духа,
// на каждой — её испытание и что уже собрано. Путь выбирают у алтаря выбора, пройдя испытание (TRIALS).
// Щелчок по карте открывает дерево умений пути.
import { PATHS, ABILITIES, ABILITY_ORDER, TIER_NEED, KNOW_GAIN, SPIRIT_GAIN, ITEMS, NPCS, CRAFT_TABS, TRIALS, SITES } from '/shared/config.js';

const $ = (id) => document.getElementById(id);
const TIER_NAMES = ['', 'Ступень I', 'Ступень II', 'Ступень III'];
const KIND_NAMES = { passive: 'действует всегда', unlock: 'открывает', spell: 'заклинание: пояс, ЛКМ', instant: 'мгновенно: цифра пояса' };
const TAGLINE = { mind: 'Наука, машины и огнестрел', spirit: 'Магия, духи и тёмные силы' };
const ART = { mind: '/assets/paths/mind.webp', spirit: '/assets/paths/spirit.webp' };
// где искать то, что нужно для испытаний
const WHERE = {
  amanita: 'в глубине лесов', peyote: 'на песке у берегов', toad: 'на берегу у самой воды',
  vise: 'ящики рудников', toolkit: 'ящики мёртвого города', drive: 'ящики радиоактивных руин',
};
const abilitiesOf = (path) => ABILITY_ORDER.filter((id) => ABILITIES[id].path === path);
const craftOf = (path) => (CRAFT_TABS.find((t) => t.path === path)?.items || []);

export class PathsWindow {
  constructor(send) {
    this.send = send;
    this.root = $('paths');
    this.body = $('pathsBody');
    this.isOpen = false;
    this.view = 'choose'; // 'choose' — выбор пути, 'mind' или 'spirit' — дерево умений пути
    this.atShrine = false; // игрок стоит у алтаря выбора (сообщает клиент)
    this.confirmReset = false;
    $('pathsClose').addEventListener('click', () => this.close());
    // клики внутри окна (разметка перерисовывается)
    this.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'view') this.show(b.dataset.view);
      else if (act === 'learn') this.send({ t: 'learn', id: b.dataset.id });
      else if (act === 'trial') this.send({ t: 'trial' });
      else if (act === 'reset') this.onReset();
      else if (act === 'data' || act === 'experiment') this.send({ t: 'research', kind: act });
      else if (act === 'absorb') this.send({ t: 'absorb' });
    });
  }

  show(view) {
    this.view = view;
    this.confirmReset = false;
    this.sig = '';
    this.refresh(this.you);
  }

  open(you) {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.you = you;
    this.show(you.pa || 'choose');
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.onClose?.();
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
    // выбранный путь показываем сразу; после сброса возвращаемся к выбору
    if (you.pa && this.view !== you.pa) this.view = you.pa;
    if (!you.pa && this.lastPath) this.view = 'choose';
    this.lastPath = you.pa;
    const sig = JSON.stringify([this.view, you.pa, you.kn, you.spi, you.ab, you.lab, you.inv.data, you.inv.artifact, you.inv.scrap, you.inv.crystal, this.confirmReset,
      this.atShrine, you.bench, you.tr, ...TRIALS.spirit.items.map((k) => you.inv[k] || 0), ...TRIALS.mind.items.map((k) => you.inv[k] || 0)]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.pts = { mind: you.kn || 0, spirit: you.spi || 0 };
    this.body.innerHTML = this.view === 'choose' ? this.renderChoose(you) : this.renderPath(you, this.view);
    this.root.dataset.view = this.view;
  }

  // ---------- испытание пути: что собрано и что осталось ----------
  trialHtml(you, id) {
    const T = TRIALS[id];
    const step = (ok, text, sub = '') => `<div class="pw-step ${ok ? 'ok' : ''}"><i>${ok ? '✔' : '○'}</i><span>${text}${sub ? ` <em>${sub}</em>` : ''}</span></div>`;
    const have = (k) => (you.inv[k] || 0) > 0;
    let html = T.items.map((k) => step(have(k), `${ITEMS[k].icon} ${ITEMS[k].name}`, have(k) ? '' : `— ${WHERE[k]}`)).join('');
    html += step(this.atShrine, `${SITES.shrine.icon} Прийти к алтарю выбора`, this.atShrine ? '' : '— отмечен на карте (N)');
    if (id === 'spirit') {
      const all = T.items.every(have);
      if (you.tr) html += step(false, `🔮 Трип идёт: убейте проводников — осталось ${you.tr[0]}`, `${you.tr[1]} с`);
      else html += step(false, `🔮 Съесть всё разом и за ${T.time} с убить ${T.guides} проводников в мир духов`);
      html += `<button data-act="trial" class="primary" ${this.atShrine && all && !you.tr ? '' : 'disabled'}>🔮 Начать ритуал</button>`;
    } else {
      html += step(this.atShrine && !!you.bench, '🔨 Собрать там верстак', '— стройка (B) → Мастерские');
      html += step(false, `${ITEMS[T.weapon].icon} Создать на нём ${ITEMS[T.weapon].name.toLowerCase()}`, '— крафт (C) → Испытание разума');
    }
    return html;
  }

  // ---------- выбор пути: две картины ----------
  renderChoose(you) {
    const card = (id) => {
      const P = PATHS[id];
      const craft = craftOf(id).map((k) => `${ITEMS[k].icon} ${ITEMS[k].name.toLowerCase()}`).join(' · ');
      return `<div class="pw-card ${id}" style="--pc:${P.color}">
        <div class="pw-art" style="background-image:url(${ART[id]})"></div><div class="pw-shade"></div>
        <div class="pw-card-body">
          <div class="pw-pts">${P.ptIcon} <b>${this.pts[id]}</b> ${P.ptName.toLowerCase()}</div>
          <div class="pw-name">${P.name}</div>
          <div class="pw-tag">${TAGLINE[id]}</div>
          <div class="pw-desc">${P.desc}</div>
          <div class="pw-trial"><div class="pw-trial-h">Испытание пути</div>${this.trialHtml(you, id)}</div>
          <div class="pw-craft"><b>Свой крафт:</b> ${craft}</div>
          <div class="pw-go" data-act="view" data-view="${id}">Умения пути →</div>
        </div></div>`;
    };
    return `<div class="pw-top"><div class="pw-title">Выберите свой путь</div>
      <div class="pw-sub">Путь выбирают <b>навсегда</b> — у алтаря выбора ${SITES.shrine.icon}, пройдя испытание. Второй путь закроется вместе со своими умениями и крафтом.</div></div>
      <div class="pw-cards">${card('mind')}${card('spirit')}</div>`;
  }

  // ---------- дерево умений одного пути ----------
  renderPath(you, id) {
    const P = PATHS[id];
    const learned = new Set(you.ab || []);
    let spent = 0;
    for (const a of learned) if (ABILITIES[a].path === id) spent += ABILITIES[a].cost;
    const pts = this.pts[id];
    const mine = you.pa === id;
    let html = `<div class="pw-path" style="--pc:${P.color}">
      <div class="pw-banner"><div class="pw-art" style="background-image:url(${ART[id]})"></div><div class="pw-shade"></div>
        <div class="pw-banner-body">
          <div><div class="pw-name">${P.icon} ${P.name}</div><div class="pw-tag">${mine ? 'Ваш путь' : TAGLINE[id]}</div></div>
          <div class="pw-banner-right">
            <div class="pw-pts big">${P.ptIcon} <b>${pts}</b> ${P.ptName.toLowerCase()}</div>
            ${mine ? `<button data-act="reset" class="${this.confirmReset ? 'danger' : ''}">${this.confirmReset ? 'Точно? Все умения пропадут — ещё раз' : 'Сменить путь (полный сброс)'}</button>`
    : '<button data-act="view" data-view="choose">← К выбору пути</button>'}
          </div>
        </div></div>
      <div class="pw-cols"><div class="pw-side">`;
    // как копить очки
    html += `<div class="pw-h">${id === 'mind' ? 'Как копить знания' : 'Как копить силу духа'}</div><div class="pw-how">${P.how}</div><div class="path-acts">`;
    if (id === 'mind') {
      const n = you.inv.data || 0;
      const ex = KNOW_GAIN.experiment;
      const canEx = Object.entries(ex.cost).every(([k, v]) => (you.inv[k] || 0) >= v);
      if (!you.lab) html += '<div class="muted small">🔬 Подойдите к лаборатории (стройка — B), чтобы изучать данные и ставить опыты</div>';
      html += `<button data-act="data" ${!you.lab || !n ? 'disabled' : ''}>💾 Изучить данные ×${n} → +${n * KNOW_GAIN.data} 📘</button>`;
      html += `<button data-act="experiment" ${!you.lab || !canEx ? 'disabled' : ''}>⚗ Опыт: ${ex.cost.scrap}${ITEMS.scrap.icon} + ${ex.cost.crystal}${ITEMS.crystal.icon} → +${ex.gain} 📘</button>`;
    } else {
      const n = you.inv.artifact || 0;
      html += `<button data-act="absorb" ${!n ? 'disabled' : ''}>🔮 Поглотить артефакты ×${n} → +${n * SPIRIT_GAIN.artifact} ✨</button>`;
      html += `<div class="muted small">🕯 У алтаря стойте неподвижно — медитация даёт силу духа (у каждого алтаря свой запас). Победы над духами и мутантами леса: от +${NPCS.crooked.spirit} ✨ за горбуна до +${NPCS.glutton.spirit} ✨ за утробника</div>`;
    }
    html += '</div>';
    if (!mine) html += `<div class="pw-h">Испытание пути</div><div class="pw-trial">${this.trialHtml(you, id)}</div>`;
    html += `<div class="pw-h">Свой крафт (C)</div><div class="pw-craftlist">${craftOf(id).map((k) => `<span>${ITEMS[k].icon} ${ITEMS[k].name}</span>`).join('')}</div>
      <div class="muted small">${mine ? 'Вкладка уже открыта в меню крафта.' : 'Вкладка появится в меню крафта, когда вы ступите на этот путь.'}</div>
      </div><div class="pw-tree">`;
    // ступени слева направо
    for (let tier = 1; tier <= 3; tier++) {
      const open = spent >= TIER_NEED[tier];
      html += `<div class="pw-tier ${open ? '' : 'shut'}"><div class="pw-tier-name">${TIER_NAMES[tier]}<span>${open ? 'открыта' : `вложите ${TIER_NEED[tier]} ${P.ptIcon} (сейчас ${spent})`}</span></div>`;
      for (const a of abilitiesOf(id)) {
        const ab = ABILITIES[a];
        if (ab.tier !== tier) continue;
        const has = learned.has(a);
        let btn;
        if (has) btn = '<div class="ab-done">✓ Изучено</div>';
        else if (!mine) btn = `<button disabled title="Сначала пройдите испытание пути у алтаря выбора">После испытания · ${ab.cost} ${P.ptIcon}</button>`;
        else {
          const poor = pts < ab.cost;
          btn = `<button data-act="learn" data-id="${a}" class="primary" ${!open || poor ? 'disabled' : ''} title="${!open ? 'Сначала нижние ступени' : poor ? `Нужно ${ab.cost} ${P.ptName.toLowerCase()}` : ''}">Изучить · ${ab.cost} ${P.ptIcon}</button>`;
        }
        const extra = ab.mana ? ` · ${ab.mana} маны` : '';
        const cd = ab.cd && ab.kind !== 'passive' ? ` · ${ab.cd} с` : '';
        html += `<div class="pw-ab ${has ? 'has' : ''}"><div class="pw-ab-ic">${ab.icon}</div>
          <div class="pw-ab-name">${ab.name}</div><div class="pw-ab-desc">${ab.desc}</div>
          <div class="pw-ab-kind">${KIND_NAMES[ab.kind]}${extra}${cd}</div>${btn}</div>`;
      }
      html += '</div>';
    }
    html += '</div></div></div>';
    return html;
  }
}
