// WebSocket-соединение с сервером.
export class Net {
  constructor() {
    this.handlers = {};
    this.ws = null;
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}`);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onerror = () => {
        if (!opened) reject(new Error('Не удалось подключиться к серверу'));
      };
      ws.onclose = () => {
        if (opened) this.handlers.close?.();
      };
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        this.handlers[m.t]?.(m);
      };
    });
  }

  send(o) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
  }
}
