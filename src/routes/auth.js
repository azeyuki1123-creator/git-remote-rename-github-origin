import { get } from '../db.js';
import { html, redirect, esc } from '../http.js';
import { login, logout, verifyPassword } from '../auth.js';
import { page, field, textInput } from '../views/layout.js';

function loginPage(error = '') {
  const body = `
  <div class="login-wrap">
    <div class="card">
      <h1>ログイン</h1>
      <p class="sub">道場の生徒名簿・指導記録・会員コンテンツを管理します。</p>
      ${error ? `<div class="flash error">${esc(error)}</div>` : ''}
      <form method="post" action="/login">
        ${field('メールアドレス', textInput('email', '', { type: 'email', required: true }))}
        ${field('パスワード', textInput('password', '', { type: 'password', required: true }))}
        <button type="submit">ログイン</button>
      </form>
      <div class="divider"></div>
      <p class="muted" style="font-size:.85rem">
        初期データのログイン例<br>
        指導者: sensei@dojo.test / dojo1234<br>
        会員: takumi@example.com / dojo1234
      </p>
    </div>
  </div>`;
  return page({ user: null, title: 'ログイン', body });
}

export function register(router) {
  router.get('/login', (ctx) => {
    if (ctx.user) return redirect(ctx.res, '/');
    html(ctx.res, loginPage(ctx.query.get('err') || ''));
  });

  router.post('/login', (ctx) => {
    const email = String(ctx.fields.email || '').trim().toLowerCase();
    const password = String(ctx.fields.password || '');
    const user = get('SELECT * FROM users WHERE lower(email) = ?', [email]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return html(ctx.res, loginPage('メールアドレスまたはパスワードが違います'), 401);
    }
    login(ctx.res, user);
    redirect(ctx.res, '/');
  });

  router.post('/logout', (ctx) => {
    logout(ctx.req, ctx.res);
    redirect(ctx.res, '/login');
  });
}
