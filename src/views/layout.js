// 画面共通のレイアウトと小さな UI パーツ。
import { esc } from '../http.js';
import { STYLE } from './style.js';

const ADMIN_NAV = [
  ['/', 'ダッシュボード'],
  ['/members', '生徒名簿'],
  ['/attendance', '出欠'],
  ['/exams', '審査'],
  ['/videos', 'フォーム添削'],
  ['/contents', 'コンテンツ'],
  ['/events', '試合・イベント'],
  ['/mail', 'メール'],
];

const MEMBER_NAV = [
  ['/', 'マイページ'],
  ['/contents', '学びの部屋'],
  ['/videos', 'フォーム添削'],
  ['/events', '試合・イベント'],
];

export function page({ user, title, active = '', body, flash = null, flashType = 'ok' }) {
  const nav = user ? (user.role === 'admin' ? ADMIN_NAV : MEMBER_NAV) : [];
  const links = nav
    .map(
      ([href, label]) =>
        `<a href="${href}" class="${active === href ? 'active' : ''}">${esc(label)}</a>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | 道場マネージャー</title>
<style>${STYLE}</style>
</head>
<body>
<header class="top">
  <div class="top-inner">
    <a class="brand" href="/">空手道場<span>マネージャー</span></a>
    <nav class="main">${links}</nav>
    ${
      user
        ? `<div class="who">
             <span class="muted">${esc(user.display_name)}（${user.role === 'admin' ? '指導者' : '会員'}）</span>
             <form method="post" action="/logout" class="inline"><button class="ghost small">ログアウト</button></form>
           </div>`
        : ''
    }
  </div>
</header>
<main>
  ${flash ? `<div class="flash ${flashType === 'error' ? 'error' : ''}">${esc(flash)}</div>` : ''}
  ${body}
</main>
<footer>道場マネージャー（プロトタイプ） — 個人情報を扱うため、本番運用前に HTTPS 化とバックアップ設定を行ってください。</footer>
</body>
</html>`;
}

export function beltTag(name, color) {
  return `<span class="belt"><i style="background:${esc(color || '#ccc')}"></i>${esc(name || '-')}</span>`;
}

export function bar(ratio) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio || 0)) * 100);
  return `<div class="bar" title="${pct}%"><i style="width:${pct}%"></i></div>`;
}

export function stat(n, label) {
  return `<div class="card stat"><div class="n">${esc(n)}</div><div class="l">${esc(label)}</div></div>`;
}

export function option(value, label, selected) {
  return `<option value="${esc(value)}"${String(selected) === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
}

export function selectBox(name, items, selected, { blank = '' } = {}) {
  const opts = [
    blank ? `<option value="">${esc(blank)}</option>` : '',
    ...items.map(([v, l]) => option(v, l, selected)),
  ].join('');
  return `<select name="${esc(name)}">${opts}</select>`;
}

export function field(label, control) {
  return `<div class="field"><label>${esc(label)}</label>${control}</div>`;
}

export function textInput(name, value = '', { type = 'text', placeholder = '', required = false } = {}) {
  return `<input type="${type}" name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}"${
    required ? ' required' : ''
  }>`;
}

export function nl2br(text) {
  return esc(text).replaceAll('\n', '<br>');
}
