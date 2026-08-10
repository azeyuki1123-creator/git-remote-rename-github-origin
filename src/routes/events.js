import { all, get, run } from '../db.js';
import { html, redirect, esc, HttpError } from '../http.js';
import { requireUser, requireAdmin } from '../auth.js';
import { page, field, textInput, selectBox, nl2br } from '../views/layout.js';
import { queueNotification, renderTemplate, mailVars } from '../mail.js';

const KINDS = ['大会', '審査', '合宿', '講習会', '演武会', 'その他'];

function eventCard(ctx, e, entries, myEntry) {
  const isAdmin = ctx.user.role === 'admin';
  const past = e.starts_on < new Date().toISOString().slice(0, 10);
  return `<div class="card ${past ? 'locked' : ''}">
    <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
      <span class="badge">${esc(e.kind)}</span>
      <span class="muted">${esc(e.starts_on)}${e.deadline_on ? `（申込締切 ${esc(e.deadline_on)}）` : ''}</span>
      ${e.fee ? `<span class="badge">参加費 ${e.fee.toLocaleString('ja-JP')} 円</span>` : ''}
    </div>
    <h2 style="margin:.3rem 0">${esc(e.title)}</h2>
    <p class="muted" style="margin:.1rem 0 .5rem">${esc(e.place)}</p>
    ${e.detail ? `<p style="margin:.2rem 0 .7rem">${nl2br(e.detail)}</p>` : ''}
    ${
      isAdmin
        ? `<p class="muted" style="margin:.2rem 0">エントリー ${entries.length} 名：${
            entries.map((x) => esc(x.name)).join('、') || 'なし'
          }</p>
          <form method="post" action="/events/${e.id}/mail" class="inline">
            <button class="ghost small">全会員に案内メールを作成</button>
          </form>`
        : `<form method="post" action="/events/${e.id}/entry" class="inline">
            <input type="hidden" name="status" value="${myEntry?.status === 'entry' ? 'cancel' : 'entry'}">
            <button class="${myEntry?.status === 'entry' ? 'ghost' : ''} small">${
              myEntry?.status === 'entry' ? 'エントリーを取り消す' : 'エントリーする'
            }</button>
          </form>
          ${myEntry?.status === 'entry' ? '<span class="badge ok">エントリー済み</span>' : ''}`
    }
  </div>`;
}

function indexPage(ctx) {
  const isAdmin = ctx.user.role === 'admin';
  const upcoming = all("SELECT * FROM events WHERE starts_on >= date('now') ORDER BY starts_on");
  const past = all("SELECT * FROM events WHERE starts_on < date('now') ORDER BY starts_on DESC LIMIT 10");

  const entriesByEvent = new Map();
  for (const row of all(
    `SELECT e.event_id, e.member_id, e.status, m.name FROM event_entries e
     JOIN members m ON m.id = e.member_id WHERE e.status = 'entry'`,
  )) {
    if (!entriesByEvent.has(row.event_id)) entriesByEvent.set(row.event_id, []);
    entriesByEvent.get(row.event_id).push(row);
  }
  const myEntries = new Map(
    ctx.user.member
      ? all('SELECT * FROM event_entries WHERE member_id = ?', [ctx.user.member.id]).map((e) => [e.event_id, e])
      : [],
  );

  const render = (list) =>
    list.map((e) => eventCard(ctx, e, entriesByEvent.get(e.id) || [], myEntries.get(e.id))).join('');

  const body = `
  <h1>試合・イベント</h1>
  <p class="sub">大会や合宿、講習会の情報をまとめて掲載します。</p>

  <h2>これからの予定</h2>
  <div class="grid cols-2">${render(upcoming) || '<p class="muted">予定はありません。</p>'}</div>

  ${
    isAdmin
      ? `<div class="card">
      <h2 style="margin-top:0">イベントを追加</h2>
      <form method="post" action="/events">
        <div class="row">
          ${field('タイトル', textInput('title', '', { required: true }))}
          ${field('種別', selectBox('kind', KINDS.map((k) => [k, k]), '大会'))}
          ${field('開催日', textInput('starts_on', '', { type: 'date', required: true }))}
        </div>
        <div class="row" style="margin-top:.75rem">
          ${field('会場', textInput('place', ''))}
          ${field('申込締切', textInput('deadline_on', '', { type: 'date' }))}
          ${field('参加費（円）', textInput('fee', '0', { type: 'number' }))}
        </div>
        <div class="field" style="margin-top:.75rem"><label>詳細</label><textarea name="detail"></textarea></div>
        <button type="submit">追加する</button>
      </form>
    </div>`
      : ''
  }

  <h2>過去のイベント</h2>
  <div class="grid cols-2">${render(past) || '<p class="muted">記録はありません。</p>'}</div>`;

  html(ctx.res, page({ user: ctx.user, title: '試合・イベント', active: '/events', body, flash: ctx.query.get('msg') }));
}

export function register(router) {
  router.get('/events', (ctx) => {
    requireUser(ctx);
    indexPage(ctx);
  });

  router.post('/events', (ctx) => {
    requireAdmin(ctx);
    const f = ctx.fields;
    if (!String(f.title || '').trim()) throw new HttpError(400, 'タイトルは必須です');
    run(
      'INSERT INTO events (title, kind, starts_on, place, deadline_on, fee, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        String(f.title).trim(),
        KINDS.includes(f.kind) ? f.kind : 'その他',
        f.starts_on,
        String(f.place || ''),
        f.deadline_on || null,
        Number(f.fee) || 0,
        String(f.detail || ''),
      ],
    );
    redirect(ctx.res, `/events?msg=${encodeURIComponent('イベントを追加しました')}`);
  });

  router.post('/events/:id/entry', (ctx) => {
    requireUser(ctx);
    const eventId = Number(ctx.params.id);
    const memberId = ctx.user.member?.id;
    if (!memberId) throw new HttpError(403, '名簿と紐づいていないアカウントです');
    const status = ctx.fields.status === 'cancel' ? 'cancel' : 'entry';
    run(
      `INSERT INTO event_entries (event_id, member_id, status) VALUES (?, ?, ?)
       ON CONFLICT(event_id, member_id) DO UPDATE SET status = excluded.status`,
      [eventId, memberId, status],
    );
    redirect(
      ctx.res,
      `/events?msg=${encodeURIComponent(status === 'entry' ? 'エントリーしました' : 'エントリーを取り消しました')}`,
    );
  });

  router.post('/events/:id/mail', (ctx) => {
    requireAdmin(ctx);
    const event = get('SELECT * FROM events WHERE id = ?', [Number(ctx.params.id)]);
    if (!event) throw new HttpError(404, 'イベントが見つかりません');
    const members = all("SELECT * FROM members WHERE status = 'active'");
    const template = `{{name}} 様

${event.kind}のご案内です。

■ ${event.title}
日時：${event.starts_on}
会場：${event.place || '追ってご連絡します'}
${event.deadline_on ? `申込締切：${event.deadline_on}\n` : ''}${event.fee ? `参加費：${event.fee} 円\n` : ''}
${event.detail}

参加をご希望の場合は会員サイトからエントリーしてください。

空手道場`;

    let count = 0;
    for (const member of members) {
      const result = queueNotification({
        member,
        subject: `【${event.kind}】${event.title} のご案内`,
        body: renderTemplate(template, mailVars(member)),
      });
      if (result.queued) count += 1;
    }
    redirect(ctx.res, `/mail?msg=${encodeURIComponent(`${count} 件の案内を下書きに追加しました`)}`);
  });
}
