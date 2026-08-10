// パスワードハッシュとログインセッション。
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { all, get, run } from './db.js';
import { parseCookies, setCookie, HttpError } from './http.js';

const SESSION_COOKIE = 'dojo_session';
const SESSION_DAYS = 14;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, expected] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function login(res, user) {
  const token = randomBytes(32).toString('hex');
  run(
    "INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))",
    [token, user.id, `+${SESSION_DAYS} days`],
  );
  setCookie(res, SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400 });
}

export function logout(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) run('DELETE FROM auth_sessions WHERE token = ?', [token]);
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
}

/** リクエストからログイン中のユーザーを解決する。未ログインなら null。 */
export function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = get(
    `SELECT u.* FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`,
    [token],
  );
  if (!row) return null;
  // 生徒アカウントには紐づく名簿レコードを添える
  row.member = get('SELECT * FROM members WHERE user_id = ?', [row.id]) || null;
  return row;
}

export function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'ログインが必要です');
  return ctx.user;
}

export function requireAdmin(ctx) {
  requireUser(ctx);
  if (ctx.user.role !== 'admin') throw new HttpError(403, 'この操作は指導者のみ実行できます');
  return ctx.user;
}

export function purgeExpiredSessions() {
  run("DELETE FROM auth_sessions WHERE expires_at <= datetime('now')");
}

export function listUsers() {
  return all('SELECT id, email, role, display_name FROM users ORDER BY id');
}
