import { all, get, run } from '../db.js';
import { html, redirect, esc, HttpError } from '../http.js';
import { requireUser, requireAdmin } from '../auth.js';
import { page, beltTag, field, textInput, selectBox, nl2br } from '../views/layout.js';
import { belts, contentsFor, canViewContent, beltById } from '../domain.js';

const CATEGORIES = ['空手', '型・基本', '組手', '栄養・食事', 'トレーニング', '仕事・法律', 'その他'];

/** 動画 URL を埋め込み HTML に変換する */
export function embedVideo(url) {
  if (!url) return '';
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/.exec(url);
  if (yt) {
    return `<div style="position:relative;padding-top:56.25%">
      <iframe src="https://www.youtube.com/embed/${esc(yt[1])}" title="動画" allowfullscreen
        style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:8px"></iframe></div>`;
  }
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) {
    return `<video controls preload="metadata" src="${esc(url)}"></video>`;
  }
  return `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">動画・資料を開く</a></p>`;
}

function indexPage(ctx) {
  const category = ctx.query.get('category') || '';
  const list = contentsFor(ctx.user, { category });
  const beltList = belts();
  const isAdmin = ctx.user.role === 'admin';

  const chips = ['', ...CATEGORIES]
    .map(
      (c) =>
        `<a href="/contents${c ? `?category=${encodeURIComponent(c)}` : ''}" class="${
          category === c ? 'active' : ''
        }">${esc(c || 'すべて')}</a>`,
    )
    .join('');

  const cards = list
    .map((c) => {
      const required = beltById(c.min_belt_id);
      const locked = !c.access.ok;
      return `<div class="card ${locked ? 'locked' : ''}">
      <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;margin-bottom:.3rem">
        <span class="badge">${esc(c.category)}</span>
        ${required ? beltTag(`${required.name}以上`, required.color) : '<span class="badge">全会員</span>'}
        ${c.is_premium ? '<span class="badge warn">プレミアム</span>' : ''}
        ${isAdmin && !c.published ? '<span class="badge">下書き</span>' : ''}
      </div>
      <h2 style="margin:.2rem 0 .3rem;font-size:1.05rem">
        ${locked ? `🔒 ${esc(c.title)}` : `<a href="/contents/${c.id}">${esc(c.title)}</a>`}
      </h2>
      <p class="muted" style="margin:0 0 .6rem;font-size:.9rem">${esc(c.summary)}</p>
      ${
        locked
          ? `<span class="badge lock">${esc(c.access.reason)}</span>`
          : `<a class="btn small ghost" href="/contents/${c.id}">見る</a>`
      }
    </div>`;
    })
    .join('');

  const adminForm = isAdmin
    ? `<div class="card">
      <h2 style="margin-top:0">コンテンツを追加</h2>
      <form method="post" action="/contents">
        <div class="row">
          ${field('タイトル', textInput('title', '', { required: true }))}
          ${field('カテゴリ', selectBox('category', CATEGORIES.map((c) => [c, c]), '空手'))}
        </div>
        <div class="row" style="margin-top:.75rem">
          ${field(
            '閲覧に必要な帯',
            selectBox('min_belt_id', beltList.map((b) => [b.id, `${b.name}以上`]), '', { blank: '全会員に公開' }),
          )}
          ${field('公開設定', selectBox('published', [[1, '公開'], [0, '下書き']], 1))}
          ${field('有料コンテンツ', selectBox('is_premium', [[0, '無料（会員向け）'], [1, 'プレミアム限定']], 0))}
        </div>
        <div class="field" style="margin-top:.75rem">
          <label>概要</label>${textInput('summary', '')}
        </div>
        <div class="field">
          <label>動画 URL（YouTube 等。省略可）</label>${textInput('video_url', '', { placeholder: 'https://youtu.be/...' })}
        </div>
        <div class="field"><label>本文</label><textarea name="body"></textarea></div>
        <button type="submit">追加する</button>
      </form>
    </div>`
    : '';

  const body = `
  <h1>学びの部屋</h1>
  <p class="sub">帯が上がるほど閲覧できる内容が増えます。空手の技術だけでなく、栄養・トレーニング・仕事の知識も配信します。</p>
  <div class="chips">${chips}</div>
  <div class="grid cols-3">${cards || '<p class="muted">まだコンテンツがありません。</p>'}</div>
  ${adminForm}`;

  html(ctx.res, page({ user: ctx.user, title: '学びの部屋', active: '/contents', body, flash: ctx.query.get('msg') }));
}

function detailPage(ctx) {
  const content = get('SELECT * FROM contents WHERE id = ?', [Number(ctx.params.id)]);
  if (!content) throw new HttpError(404, 'コンテンツが見つかりません');
  const access = canViewContent(ctx.user, content);
  const required = beltById(content.min_belt_id);

  if (!access.ok) {
    const body = `<div class="card">
      <h1>🔒 ${esc(content.title)}</h1>
      <p>${esc(access.reason)}</p>
      <p class="muted">稽古を重ねて帯が上がると自動的に解放されます。</p>
      <a class="btn ghost" href="/contents">一覧に戻る</a>
    </div>`;
    return html(ctx.res, page({ user: ctx.user, title: content.title, active: '/contents', body }), 403);
  }

  const body = `
  <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.4rem">
    <span class="badge">${esc(content.category)}</span>
    ${required ? beltTag(`${required.name}以上`, required.color) : '<span class="badge">全会員</span>'}
    ${content.is_premium ? '<span class="badge warn">プレミアム</span>' : ''}
  </div>
  <h1>${esc(content.title)}</h1>
  <p class="sub">${esc(content.summary)}</p>
  <div class="card">
    ${embedVideo(content.video_url)}
    <div style="margin-top:${content.video_url ? '1rem' : '0'}">${nl2br(content.body)}</div>
  </div>
  <a class="btn ghost" href="/contents">一覧に戻る</a>
  ${
    ctx.user.role === 'admin'
      ? `<form method="post" action="/contents/${content.id}/delete" class="inline"
           onsubmit="return confirm('削除します。よろしいですか？')">
          <button class="ghost small">削除</button></form>`
      : ''
  }`;

  html(ctx.res, page({ user: ctx.user, title: content.title, active: '/contents', body }));
}

export function register(router) {
  router.get('/contents', (ctx) => {
    requireUser(ctx);
    indexPage(ctx);
  });

  router.post('/contents', (ctx) => {
    requireAdmin(ctx);
    const f = ctx.fields;
    if (!String(f.title || '').trim()) throw new HttpError(400, 'タイトルは必須です');
    run(
      `INSERT INTO contents (title, category, summary, body, video_url, min_belt_id, is_premium, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(f.title).trim(),
        String(f.category || 'その他'),
        String(f.summary || ''),
        String(f.body || ''),
        String(f.video_url || ''),
        f.min_belt_id ? Number(f.min_belt_id) : null,
        Number(f.is_premium) ? 1 : 0,
        Number(f.published) ? 1 : 0,
      ],
    );
    redirect(ctx.res, `/contents?msg=${encodeURIComponent('コンテンツを追加しました')}`);
  });

  router.get('/contents/:id', (ctx) => {
    requireUser(ctx);
    detailPage(ctx);
  });

  router.post('/contents/:id/delete', (ctx) => {
    requireAdmin(ctx);
    run('DELETE FROM contents WHERE id = ?', [Number(ctx.params.id)]);
    redirect(ctx.res, `/contents?msg=${encodeURIComponent('削除しました')}`);
  });

  // 一覧のカテゴリは他モジュールからも参照できるように公開しておく
  return CATEGORIES;
}
