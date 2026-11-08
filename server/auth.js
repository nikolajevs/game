// Локальные учётные записи игроков.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const HASH_BYTES = 64;
const TOKEN_RE = /^[a-f0-9]{32}$/;
const USER_RE = /^[\p{L}\p{N}_-]{3,20}$/u;
const DUMMY_SALT = 'mutagen-login-timing-salt';

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export class AuthStore {
  constructor(file) {
    this.file = file;
    this.accounts = new Map();
    this.byToken = new Map();
    this.load();
  }

  normalize(username) {
    return String(username || '').trim().toLowerCase();
  }

  publicAccount(account) {
    return { token: account.token, username: account.username };
  }

  load() {
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return;
    }
    if (!Array.isArray(saved)) return;
    for (const account of saved) {
      if (!account || typeof account.username !== 'string' || typeof account.salt !== 'string' ||
          typeof account.passwordHash !== 'string' || !TOKEN_RE.test(account.token || '') ||
          !USER_RE.test(account.username) || !/^[a-f0-9]{32}$/.test(account.salt) ||
          !/^[a-f0-9]{128}$/.test(account.passwordHash)) continue;
      const key = this.normalize(account.username);
      if (this.accounts.has(key) || this.byToken.has(account.token)) continue;
      this.accounts.set(key, account);
      this.byToken.set(account.token, account);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...this.accounts.values()]));
    fs.renameSync(tmp, this.file);
  }

  async register(usernameInput, passwordInput) {
    const username = String(usernameInput || '').trim();
    const key = this.normalize(username);
    const password = String(passwordInput || '');
    if (!USER_RE.test(username)) {
      throw new AuthError('Имя пользователя: 3–20 букв, цифр, «_» или «-».');
    }
    if (password.length < 8 || password.length > 128) {
      throw new AuthError('Пароль должен содержать от 8 до 128 символов.');
    }
    if (this.accounts.has(key)) throw new AuthError('Это имя пользователя уже занято.', 409);

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(password, salt, HASH_BYTES)).toString('hex');
    // Повторная проверка закрывает гонку двух одновременных регистраций.
    if (this.accounts.has(key)) throw new AuthError('Это имя пользователя уже занято.', 409);
    const account = {
      username,
      salt,
      passwordHash,
      token: crypto.randomBytes(16).toString('hex'),
    };
    this.accounts.set(key, account);
    this.byToken.set(account.token, account);
    try {
      this.save();
    } catch (error) {
      this.accounts.delete(key);
      this.byToken.delete(account.token);
      throw error;
    }
    return this.publicAccount(account);
  }

  async login(usernameInput, passwordInput) {
    const username = String(usernameInput || '').trim();
    const password = String(passwordInput || '');
    if (password.length > 128) throw new AuthError('Неверное имя пользователя или пароль.', 401);
    const account = this.accounts.get(this.normalize(username));
    const salt = account?.salt || DUMMY_SALT;
    const actual = await scrypt(password, salt, HASH_BYTES);
    const expected = account ? Buffer.from(account.passwordHash, 'hex') : Buffer.alloc(HASH_BYTES);
    if (!account || !crypto.timingSafeEqual(actual, expected)) {
      throw new AuthError('Неверное имя пользователя или пароль.', 401);
    }
    return this.publicAccount(account);
  }

  session(token) {
    const account = typeof token === 'string' ? this.byToken.get(token) : null;
    return account ? this.publicAccount(account) : null;
  }

  hasToken(token) {
    return this.session(token) !== null;
  }
}
