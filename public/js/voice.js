// Голосовой чат. Звук идёт между браузерами напрямую (WebRTC), сервер игры только знакомит их.
// Слышно тех, кто рядом (чем дальше — тем тише), и друзей — по «рации» на любом расстоянии.
// Говорить — держать V; есть и режим открытого микрофона.
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
const GRACE = 4000; // мс: собеседник пропал из слышимости — держим связь ещё столько
const RETRY = 5000; // мс до новой попытки после обрыва

export class Voice {
  constructor(send) {
    this.send = send;
    this.enabled = false;
    this.mode = 'ptt'; // 'ptt' — говорить по клавише, 'open' — микрофон открыт всегда
    this.talking = false;
    this.key = false;
    this.stream = null;
    this.peers = new Map(); // id игрока -> { pc, audio, seen, initiator }
    this.retry = new Map(); // id -> когда можно пробовать снова
    this.myId = null;
    this.onChange = null;
    this.error = '';
  }

  get supported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);
  }

  async enable() {
    if (this.enabled) return true;
    this.error = '';
    if (!this.supported) {
      // браузеры дают микрофон только страницам по https и на localhost
      this.error = window.isSecureContext ? 'Браузер не поддерживает голосовой чат' : 'Микрофон доступен только по https или на localhost';
      this.onChange?.();
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      this.error = e?.name === 'NotAllowedError' ? 'Доступ к микрофону запрещён — разрешите его в браузере' : 'Микрофон не найден';
      this.onChange?.();
      return false;
    }
    this.enabled = true;
    this.watchLevel();
    this.applyTrack();
    this.send({ t: 'voice', on: true });
    this.onChange?.();
    return true;
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.setTalkFlag(false);
    for (const id of [...this.peers.keys()]) this.drop(id, true);
    for (const t of this.stream?.getTracks() || []) t.stop();
    this.stream = null;
    clearInterval(this.levelTimer);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.send({ t: 'voice', on: false });
    this.onChange?.();
  }

  setMode(mode) {
    this.mode = mode === 'open' ? 'open' : 'ptt';
    this.applyTrack();
    this.onChange?.();
  }

  // клавиша «говорить» нажата или отпущена
  setKey(on) {
    this.key = !!on;
    this.applyTrack();
  }

  applyTrack() {
    if (!this.enabled) return;
    const live = this.mode === 'open' || this.key;
    for (const t of this.stream.getAudioTracks()) t.enabled = live;
    if (this.mode === 'ptt') this.setTalkFlag(live);
  }

  setTalkFlag(on) {
    if (this.talking === on) return;
    this.talking = on;
    this.send({ t: 'talk', on });
    this.onChange?.();
  }

  // открытый микрофон: значок «говорит» — по громкости голоса
  watchLevel() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      this.ctx.createMediaStreamSource(this.stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let quiet = 0;
      this.levelTimer = setInterval(() => {
        if (this.mode !== 'open' || !this.enabled) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        const loud = Math.sqrt(sum / buf.length) > 6;
        quiet = loud ? 0 : quiet + 1;
        if (loud) this.setTalkFlag(true);
        else if (quiet > 5) this.setTalkFlag(false);
      }, 120);
    } catch { /* без индикатора обойдёмся */ }
  }

  // targets: Map(id игрока -> громкость 0..1) — кого сейчас должно быть слышно
  sync(targets, myId) {
    this.myId = myId;
    if (!this.enabled) return;
    const now = performance.now();
    for (const [id, vol] of targets) {
      let peer = this.peers.get(id);
      if (!peer) {
        if ((this.retry.get(id) || 0) > now) continue;
        peer = this.open(id, myId < id); // звонит тот, у кого номер меньше
      }
      peer.seen = now;
      peer.audio.volume = Math.max(0, Math.min(1, vol));
    }
    for (const [id, peer] of this.peers) if (now - peer.seen > GRACE) this.drop(id, true);
  }

  open(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = new Audio();
    audio.autoplay = true;
    const peer = { pc, audio, seen: performance.now(), initiator, pending: [] };
    this.peers.set(id, peer);
    for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      audio.play().catch(() => {});
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ t: 'rtc', to: id, d: { ice: e.candidate } });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (this.peers.get(id) === peer) {
          this.retry.set(id, performance.now() + RETRY);
          this.drop(id, false);
        }
      }
      this.onChange?.();
    };
    if (initiator) {
      pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => {
        this.send({ t: 'rtc', to: id, d: { sdp: pc.localDescription } });
      }).catch(() => this.drop(id, false));
    }
    return peer;
  }

  drop(id, tell) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.audio.srcObject = null;
    if (tell) this.send({ t: 'rtc', to: id, d: { bye: 1 } });
    this.onChange?.();
  }

  // сообщение от другого игрока, переданное сервером
  async onSignal(from, d) {
    if (!this.enabled || !d) return;
    if (d.bye) return this.drop(from, false);
    let peer = this.peers.get(from);
    try {
      if (d.sdp) {
        if (d.sdp.type === 'offer') {
          // новый звонок: старое соединение с этим игроком больше не нужно
          if (peer && (peer.initiator || peer.pc.signalingState !== 'stable' || peer.pc.remoteDescription)) {
            this.drop(from, false);
            peer = null;
          }
          if (!peer) peer = this.open(from, false);
          await peer.pc.setRemoteDescription(d.sdp);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          this.send({ t: 'rtc', to: from, d: { sdp: peer.pc.localDescription } });
        } else if (peer) await peer.pc.setRemoteDescription(d.sdp);
        if (peer) {
          for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
        }
      } else if (d.ice && peer) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(d.ice).catch(() => {});
        else peer.pending.push(d.ice);
      }
    } catch (e) {
      console.warn('Голос: не удалось соединиться', e);
      this.drop(from, false);
    }
  }

  // сколько собеседников на связи
  get connected() {
    let n = 0;
    for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') n++;
    return n;
  }
}
