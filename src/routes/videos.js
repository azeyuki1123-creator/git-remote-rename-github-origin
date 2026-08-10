import { createReadStream } from 'node:fs';
import { stat as fsStat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { all, get, run, UPLOAD_DIR } from '../db.js';
import { html, redirect, esc, saveUpload, HttpError } from '../http.js';
import { requireUser, requireAdmin } from '../auth.js';
import { page, field, textInput, selectBox, nl2br } from '../views/layout.js';
import { listMembers } from '../domain.js';
import { embedVideo } from './contents.js';

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};

function submissionSource(v) {
  if (v.file_name) return `/uploads/${v.file_name}`;
  return v.url;
}

function indexPage(ctx) {
  const isAdmin = ctx.user.role === 'admin';
  const filter = ctx.query.get('status') || '';
  const params = [];
  let sql = `SELECT v.*, m.name AS member_name FROM video_submissions v
             JOIN members m ON m.id = v.member_id`;
  const where = [];
  if (!isAdmin) {
    if (!ctx.user.member) throw new HttpError(403, '名簿と紐づいていないアカウントです');
    where.push('v.member_id = ?');
    params.push(ctx.user.member.id);
  }
  if (filter) {
    where.push('v.status = ?');
    params.push(filter);
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY v.id DESC LIMIT 100';
  const rows = all(sql, params);

  const memberOptions = isAdmin ? listMembers({ status: 'active' }).map((m) => [m.id, m.name]) : [];

  const uploadForm = `
  <div class="card">
    <h2 style="margin-top:0">動画を提出する</h2>
    <p class="muted" style="font-size:.9rem;margin-top:0">スマホで撮影した稽古動画をアップロードすると、指導者が一言アドバイスを返します。</p>
    <form method="post" action="/videos" enctype="multipart/form-data">
      ${isAdmin ? field('生徒', selectBox('member_id', memberOptions, '')) : ''}
      ${field('タイトル', textInput('title', '', { required: true, placeholder: '例）平安初段 通し' }))}
      ${field('気になっているところ', textInput('note', '', { placeholder: '例）引き手が下がっている気がします' }))}
      ${field('動画ファイル（mp4 / mov / webm）', '<input type="file" name="video" accept="video/*">')}
      ${field('または動画 URL', textInput('url', '', { placeholder: 'https://youtu.be/...' }))}
      <button type="submit">提出する</button>
    </form>
  </div>`;

  const body = `
  <h1>フォーム添削</h1>
  <p class="sub">${isAdmin ? '生徒から届いた動画を確認し、アドバイスを返します。' : '自分の動画と、もらったアドバイスを確認できます。'}</p>
  ${
    isAdmin
      ? `<div class="chips">
          <a href="/videos" class="${filter === '' ? 'active' : ''}">すべて</a>
          <a href="/videos?status=pending" class="${filter === 'pending' ? 'active' : ''}">未添削</a>
          <a href="/videos?status=reviewed" class="${filter === 'reviewed' ? 'active' : ''}">添削済み</a>
        </div>`
      : ''
  }
  <div class="card">
    <div class="table-wrap"><table>
      <tr><th>提出日</th>${isAdmin ? '<th>生徒</th>' : ''}<th>タイトル</th><th>状態</th><th></th></tr>
      ${
        rows.length
          ? rows
              .map(
                (v) => `<tr>
        <td class="nowrap">${esc(String(v.created_at).slice(0, 10))}</td>
        ${isAdmin ? `<td>${esc(v.member_name)}</td>` : ''}
        <td><a href="/videos/${v.id}">${esc(v.title)}</a></td>
        <td>${
          v.status === 'pending' ? '<span class="badge warn">未添削</span>' : '<span class="badge ok">添削済み</span>'
        }</td>
        <td class="right"><a class="btn small ghost" href="/videos/${v.id}">開く</a></td>
      </tr>`,
              )
              .join('')
          : '<tr><td colspan="5" class="muted">まだ提出はありません。</td></tr>'
      }
    </table></div>
  </div>
  ${uploadForm}`;

  html(ctx.res, page({ user: ctx.user, title: 'フォーム添削', active: '/videos', body, flash: ctx.query.get('msg') }));
}

function detailPage(ctx) {
  const v = get(
    `SELECT v.*, m.name AS member_name, m.id AS mid FROM video_submissions v
     JOIN members m ON m.id = v.member_id WHERE v.id = ?`,
    [Number(ctx.params.id)],
  );
  if (!v) throw new HttpError(404, '動画が見つかりません');
  const isAdmin = ctx.user.role === 'admin';
  if (!isAdmin && ctx.user.member?.id !== v.member_id) throw new HttpError(403, '閲覧権限がありません');

  const feedback = all(
    `SELECT f.*, u.display_name FROM video_feedback f
     LEFT JOIN users u ON u.id = f.author_id
     WHERE f.submission_id = ? ORDER BY f.id`,
    [v.id],
  );

  const body = `
  <h1>${esc(v.title)}</h1>
  <p class="sub">${esc(v.member_name)} ／ ${esc(v.created_at)}</p>

  <div class="grid cols-2">
    <div class="card">
      ${embedVideo(submissionSource(v)) || '<p class="muted">動画が添付されていません。</p>'}
      ${v.note ? `<p style="margin-bottom:0"><strong>本人コメント：</strong>${nl2br(v.note)}</p>` : ''}
    </div>

    <div class="card">
      <h2 style="margin-top:0">アドバイス</h2>
      ${
        feedback.length
          ? `<ul class="list-reset">${feedback
              .map(
                (f) => `<li style="padding:.5rem 0;border-bottom:1px solid var(--line)">
              ${nl2br(f.comment)}
              <div class="muted" style="font-size:.82rem">${esc(f.display_name || '指導者')} ／ ${esc(
                f.created_at,
              )}${f.score ? ` ／ ${f.score} 点` : ''}</div>
            </li>`,
              )
              .join('')}</ul>`
          : '<p class="muted">まだアドバイスはありません。</p>'
      }
      ${
        isAdmin
          ? `<form method="post" action="/videos/${v.id}/feedback" style="margin-top:.8rem">
              <div class="field"><label>一言アドバイス</label><textarea name="comment" required
                placeholder="例）引き手はよくなりました。次は突きの終わりで軸足の膝が抜けないように意識しましょう。"></textarea></div>
              ${field('評価（任意・100点満点）', textInput('score', '', { type: 'number' }))}
              <button type="submit">アドバイスを送る</button>
            </form>`
          : ''
      }
    </div>
  </div>
  <a class="btn ghost" href="/videos">一覧に戻る</a>`;

  html(ctx.res, page({ user: ctx.user, title: v.title, active: '/videos', body, flash: ctx.query.get('msg') }));
}

export function register(router) {
  router.get('/videos', (ctx) => {
    requireUser(ctx);
    indexPage(ctx);
  });

  router.post('/videos', async (ctx) => {
    requireUser(ctx);
    const isAdmin = ctx.user.role === 'admin';
    const memberId = isAdmin ? Number(ctx.fields.member_id) : ctx.user.member?.id;
    if (!memberId) throw new HttpError(400, '生徒を特定できません');
    const title = String(ctx.fields.title || '').trim();
    if (!title) throw new HttpError(400, 'タイトルを入力してください');

    const fileName = await saveUpload(ctx.files.video);
    const url = String(ctx.fields.url || '').trim();
    if (!fileName && !url) throw new HttpError(400, '動画ファイルか URL のどちらかを指定してください');

    const info = run(
      'INSERT INTO video_submissions (member_id, title, note, file_name, url) VALUES (?, ?, ?, ?, ?)',
      [memberId, title, String(ctx.fields.note || ''), fileName, url],
    );
    redirect(ctx.res, `/videos/${info.lastInsertRowid}?msg=${encodeURIComponent('動画を提出しました')}`);
  });

  router.get('/videos/:id', (ctx) => {
    requireUser(ctx);
    detailPage(ctx);
  });

  router.post('/videos/:id/feedback', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const comment = String(ctx.fields.comment || '').trim();
    if (!comment) throw new HttpError(400, 'コメントを入力してください');
    const score = ctx.fields.score ? Number(ctx.fields.score) : null;
    run('INSERT INTO video_feedback (submission_id, author_id, comment, score) VALUES (?, ?, ?, ?)', [
      id,
      ctx.user.id,
      comment,
      Number.isFinite(score) ? score : null,
    ]);
    run("UPDATE video_submissions SET status = 'reviewed' WHERE id = ?", [id]);
    redirect(ctx.res, `/videos/${id}?msg=${encodeURIComponent('アドバイスを送りました')}`);
  });

  // アップロードされた動画の配信（ログイン必須・本人か指導者のみ）
  router.get('/uploads/:file', async (ctx) => {
    requireUser(ctx);
    const name = basename(ctx.params.file);
    const owner = get('SELECT * FROM video_submissions WHERE file_name = ?', [name]);
    if (!owner) throw new HttpError(404, 'ファイルが見つかりません');
    if (ctx.user.role !== 'admin' && ctx.user.member?.id !== owner.member_id) {
      throw new HttpError(403, '閲覧権限がありません');
    }

    const path = join(UPLOAD_DIR, name);
    let info;
    try {
      info = await fsStat(path);
    } catch {
      throw new HttpError(404, 'ファイルが見つかりません');
    }
    const type = MIME[extname(name).toLowerCase()] || 'application/octet-stream';
    const range = ctx.req.headers.range;

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : info.size - 1;
      if (start >= info.size) {
        ctx.res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
        return ctx.res.end();
      }
      ctx.res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      });
      return createReadStream(path, { start, end }).pipe(ctx.res);
    }

    ctx.res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Accept-Ranges': 'bytes' });
    return createReadStream(path).pipe(ctx.res);
  });
}
