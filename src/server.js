import http from 'node:http';
import { Router } from './router.js';
import { currentUser, purgeExpiredSessions } from './auth.js';
import { parseBody, html, redirect, esc, HttpError } from './http.js';
import { page } from './views/layout.js';
import { get } from './db.js';
import { hashPassword } from './auth.js';
import { run } from './db.js';

import * as authRoutes from './routes/auth.js';
import * as dashboardRoutes from './routes/dashboard.js';
import * as memberRoutes from './routes/members.js';
import * as attendanceRoutes from './routes/attendance.js';
import * as examRoutes from './routes/exams.js';
import * as contentRoutes from './routes/contents.js';
import * as videoRoutes from './routes/videos.js';
import * as eventRoutes from './routes/events.js';
import * as mailRoutes from './routes/mail.js';
import * as stampRoutes from './routes/stamps.js';
import * as lineRoutes from './routes/line.js';

const router = new Router();
for (const mod of [
  authRoutes,
  dashboardRoutes,
  memberRoutes,
  attendanceRoutes,
  examRoutes,
  contentRoutes,
  videoRoutes,
  eventRoutes,
  mailRoutes,
  stampRoutes,
  lineRoutes,
]) {
  mod.register(router);
}

function errorPage(ctx, status, message) {
  const body = `<div class="card">
    <h1>${status}</h1>
    <p>${esc(message)}</p>
    <a class="btn ghost" href="/">トップへ戻る</a>
  </div>`;
  html(ctx.res, page({ user: ctx.user, title: `エラー ${status}`, body }), status);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const ctx = {
      req,
      res,
      url,
      query: url.searchParams,
      params: {},
      fields: {},
      files: {},
      user: null,
    };

    try {
      ctx.user = currentUser(req);
      const match = router.match(req.method, url.pathname);
      if (!match) throw new HttpError(404, 'ページが見つかりません');
      ctx.params = match.params;

      if (req.method === 'POST') {
        const parsed = await parseBody(req);
        ctx.fields = parsed.fields;
        ctx.files = parsed.files;
        ctx.raw = parsed.raw;
      }

      await match.handler(ctx);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 401 && req.method === 'GET') return redirect(res, '/login');
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      errorPage(ctx, status, status === 500 ? 'サーバー内部でエラーが発生しました' : err.message);
    }
  });
}

/** 初回起動時に管理者アカウントが 1 つも無ければ作る */
function ensureAdmin() {
  const admin = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (admin) return;
  const email = process.env.ADMIN_EMAIL || 'sensei@dojo.test';
  const password = process.env.ADMIN_PASSWORD || 'dojo1234';
  run("INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, 'admin', ?)", [
    email,
    hashPassword(password),
    process.env.ADMIN_NAME || '道場長',
  ]);
  console.log(`初期管理者を作成しました: ${email} / ${password}`);
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  ensureAdmin();
  purgeExpiredSessions();
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => {
    console.log(`道場マネージャーを起動しました → http://localhost:${port}`);
  });
}
