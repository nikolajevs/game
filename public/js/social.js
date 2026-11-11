// Окно друзей (O): приглашения, список друзей, игроки в сети — и настройки голосового чата.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Social {
  constructor(send, voice) {
    this.send = send;
    this.voice = voice;
    this.root = $('social');
    this.body = $('socialBody');
    this.isOpen = false;
    this.data = { list: [], inv: [], max: 12 };
    this.players = [];
    this.myUid = null;
    this.confirm = null; // uid друга, которого собрались убрать
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    $('socialClose').addEventListener('click', () => this.toggle(false));
    this.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-op]');
      if (!b || b.disabled) return;
      const { op, uid } = b.dataset;
      if (op === 'remove' && this.confirm !== uid) {
        this.confirm = uid;
        return this.render();
      }
      this.confirm = null;
      this.send({ t: 'friend', op, uid });
    });
    $('voiceToggle').addEventListener('click', () => this.onVoiceToggle?.());
    $('voiceMode').addEventListener('click', () => voice.setMode(voice.mode === 'ptt' ? 'open' : 'ptt'));
  }

  toggle(on) {
    this.isOpen = on ?? !this.isOpen;
    this.root.classList.toggle('hidden', !this.isOpen);
    this.confirm = null;
    if (this.isOpen) {
      this.render();
      this.renderVoice();
    }
    return this.isOpen;
  }

  setFriends(m) {
    this.data = m;
    const n = m.inv.length;
    const badge = $('friendBadge');
    badge.textContent = n;
    badge.classList.toggle('hidden', !n);
    if (this.isOpen) this.render();
  }

  setPlayers(list) {
    this.players = list;
    if (this.isOpen) this.render();
  }

  render() {
    const { list, inv, max } = this.data;
    const sig = JSON.stringify([list.map((f) => [f.u, f.n, f.on, f.vc, f.dd]), inv, this.players.map((p) => [p.u, p.n]), this.confirm]);
    if (sig === this.sig) return;
    this.sig = sig;
    const friends = new Set(list.map((f) => f.u));
    const invited = new Set(inv.map((i) => i.u));
    let html = '';
    if (inv.length) {
      html += '<div class="so-h">Зовут в друзья</div>';
      html += inv.map((i) => `<div class="so-row inv"><span class="so-n">🤝 ${esc(i.n)}</span>
        <button class="primary" data-op="accept" data-uid="${esc(i.u)}">Принять</button><button data-op="decline" data-uid="${esc(i.u)}">Нет</button></div>`).join('');
    }
    html += `<div class="so-h">Друзья <span class="muted">${list.length}/${max}</span></div>`;
    html += list.length ? [...list].sort((a, b) => b.on - a.on).map((f) => `<div class="so-row${f.on ? '' : ' off'}">
        <span class="so-dot" style="background:${f.on ? esc(f.c) : '#555'}"></span>
        <span class="so-n">${esc(f.n)} <em>${f.on ? (f.dd ? 'погиб' : 'в сети') : 'не в сети'}${f.vc ? ' · 🎙' : ''}</em></span>
        <button data-op="remove" data-uid="${esc(f.u)}" class="${this.confirm === f.u ? 'danger' : ''}">${this.confirm === f.u ? 'Точно убрать?' : 'Убрать'}</button></div>`).join('')
      : '<div class="muted small so-empty">Пока никого. Позовите игрока из списка ниже — он должен согласиться.</div>';
    const others = this.players.filter((p) => p.u !== this.myUid && !friends.has(p.u));
    html += '<div class="so-h">Игроки в сети</div>';
    html += others.length ? others.map((p) => `<div class="so-row">
        <span class="so-dot" style="background:${esc(p.c)}"></span><span class="so-n">${esc(p.n)}</span>
        ${invited.has(p.u) ? `<button class="primary" data-op="accept" data-uid="${esc(p.u)}">Принять</button>`
    : `<button data-op="invite" data-uid="${esc(p.u)}" ${list.length >= max ? 'disabled' : ''}>Позвать в друзья</button>`}</div>`).join('')
      : '<div class="muted small so-empty">Кроме вас и ваших друзей на острове никого нет.</div>';
    this.body.innerHTML = html;
  }

  renderVoice() {
    const v = this.voice;
    $('voiceToggle').textContent = v.enabled ? '🎙 Выключить микрофон' : '🎙 Включить микрофон';
    $('voiceToggle').classList.toggle('primary', !v.enabled);
    $('voiceMode').textContent = v.mode === 'ptt' ? 'Режим: по клавише V' : 'Режим: открытый микрофон';
    $('voiceMode').disabled = !v.enabled;
    let state;
    if (v.error) state = `<span class="bad">✖ ${esc(v.error)}</span>`;
    else if (!v.enabled) state = 'Слышно тех, кто рядом (чем дальше — тем тише), а друзей — по «рации» где угодно. Вас слышат только те, у кого голос тоже включён.';
    else state = `${v.talking ? '🔊 Вы говорите' : v.mode === 'ptt' ? 'Держите <kbd>V</kbd>, чтобы говорить' : 'Микрофон открыт'} · на связи: ${v.connected}`;
    $('voiceState').innerHTML = state;
    const btn = $('btnVoice');
    btn.textContent = v.enabled ? (v.talking ? '🔊 Говорю' : '🎙 Вкл') : '🎙 Голос';
    btn.classList.toggle('on', v.enabled);
    btn.classList.toggle('talk', v.enabled && v.talking);
  }
}
