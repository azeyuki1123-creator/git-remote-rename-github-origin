import { all, get, run, tx } from '../db.js';
import { html, redirect, esc, HttpError } from '../http.js';
import { requireAdmin } from '../auth.js';
import { page, beltTag, field, textInput, selectBox, stat } from '../views/layout.js';
import { listMembers } from '../domain.js';
import { branches, grantStamp, voidStampForSession, stampSummary } from '../stamps.js';

const STATUSES = [
  ['present', '出席'],
  ['late', '遅刻'],
  ['absent', '欠席'],
];

function indexPage(ctx) {
  const sessions = all(
    `SELECT t.*,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = t.id AND a.status = 'present') AS present,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = t.id AND a.status = 'late') AS late,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = t.id AND a.status = 'absent') AS absent
     FROM training_sessions t ORDER BY t.held_on DESC, t.id DESC LIMIT 60`,
  );
  const thisMonth = get("SELECT COUNT(*) AS c FROM training_sessions WHERE held_on >= date('now','start of month')").c;
  const avg = get(
    `SELECT COALESCE(AVG(p), 0) AS a FROM (
       SELECT COUNT(*) AS p FROM attendance WHERE status IN ('present','late') GROUP BY session_id
     )`,
  ).a;

  const body = `
  <h1>出欠管理</h1>
  <p class="sub">稽古を登録し、その場で出欠をチェックします。</p>

  <div class="grid cols-3">
    ${stat(sessions.length, '登録済みの稽古（直近）')}
    ${stat(thisMonth, '今月の稽古')}
    ${stat(Math.round(avg * 10) / 10, '1回あたり平均出席')}
  </div>

  <div class="card">
    <h2 style="margin-top:0">稽古を追加</h2>
    <form method="post" action="/attendance">
      <div class="row">
        ${field('日付', textInput('held_on', new Date().toISOString().slice(0, 10), { type: 'date', required: true }))}
        ${field('内容', textInput('title', '通常稽古', { required: true }))}
        ${field('支部', selectBox('branch_id', branches().map((b) => [b.id, b.name]), ''))}
        ${field('場所', textInput('place', ''))}
        <div class="field" style="flex:0 0 auto"><button type="submit">作成して出欠をとる</button></div>
      </div>
    </form>
  </div>

  <div class="card">
    <div class="table-wrap"><table>
      <tr><th>日付</th><th>内容</th><th>場所</th><th>出席</th><th>遅刻</th><th>欠席</th><th></th></tr>
      ${
        sessions.length
          ? sessions
              .map(
                (s) => `<tr>
        <td class="nowrap">${esc(s.held_on)}</td>
        <td><a href="/attendance/${s.id}">${esc(s.title)}</a></td>
        <td>${esc(s.place)}</td>
        <td>${s.present}</td><td>${s.late}</td><td>${s.absent}</td>
        <td class="right"><a class="btn small ghost" href="/attendance/${s.id}">出欠入力</a></td>
      </tr>`,
              )
              .join('')
          : '<tr><td colspan="7" class="muted">まだ稽古がありません。</td></tr>'
      }
    </table></div>
  </div>`;

  html(ctx.res, page({ user: ctx.user, title: '出欠管理', active: '/attendance', body, flash: ctx.query.get('msg') }));
}

function detailPage(ctx) {
  const id = Number(ctx.params.id);
  const session = get('SELECT * FROM training_sessions WHERE id = ?', [id]);
  if (!session) throw new HttpError(404, '稽古が見つかりません');
  const members = listMembers({ status: 'active', branchId: session.branch_id || '' });
  const current = new Map(
    all('SELECT * FROM attendance WHERE session_id = ?', [id]).map((a) => [a.member_id, a.status]),
  );
  const stampedHere = new Set(
    all("SELECT member_id FROM stamps WHERE session_id = ? AND status = 'active'", [id]).map((s) => s.member_id),
  );

  const body = `
  <h1>${esc(session.held_on)} ${esc(session.title)}</h1>
  <p class="sub">${esc(session.place || '場所未設定')} ／ 在籍中の生徒 ${members.length} 名</p>

  <form method="post" action="/attendance/${id}">
    <div class="card">
      <div class="table-wrap"><table>
        <tr><th>生徒</th><th>帯</th><th>出欠</th><th class="right">スタンプ</th></tr>
        ${members
          .map((m) => {
            const status = current.get(m.id) || 'present';
            const summary = stampSummary(m);
            return `<tr>
          <td>${esc(m.name)}<br><span class="muted" style="font-size:.8rem">${esc(m.kana)}</span></td>
          <td>${beltTag(m.belt_name, m.belt_color)}</td>
          <td class="nowrap">${STATUSES.map(
            ([v, label]) =>
              `<label style="display:inline-flex;align-items:center;gap:.2rem;margin-right:.8rem;color:var(--ink)">
                <input type="radio" name="s_${m.id}" value="${v}" style="width:auto"${
                  status === v ? ' checked' : ''
                }> ${esc(label)}</label>`,
          ).join('')}</td>
          <td class="right nowrap">${summary.progress} / ${summary.perCard}${
            stampedHere.has(m.id) ? ' <span class="badge ok">押印済</span>' : ''
          }</td>
        </tr>`;
          })
          .join('')}
      </table></div>
      <div class="row" style="margin-top:.9rem">
        ${field('稽古メモ', textInput('note', session.note, { placeholder: '指導内容・気づきなど' }))}
        ${field('スタンプ', selectBox('auto_stamp', [[1, '出席・遅刻に自動で押す'], [0, '押さない']], 1))}
        <div class="field" style="flex:0 0 auto"><button type="submit">出欠を保存</button></div>
      </div>
      <p class="muted" style="font-size:.85rem;margin-bottom:0">
        保存すると出席・遅刻の生徒にスタンプが 1 個ずつ押されます（同じ稽古で二重には押されません）。
        欠席に直すと、その稽古のスタンプは自動で取り消されます。
      </p>
    </div>
  </form>`;

  html(ctx.res, page({ user: ctx.user, title: '出欠入力', active: '/attendance', body, flash: ctx.query.get('msg') }));
}

export function register(router) {
  router.get('/attendance', (ctx) => {
    requireAdmin(ctx);
    indexPage(ctx);
  });

  router.post('/attendance', (ctx) => {
    requireAdmin(ctx);
    const info = run('INSERT INTO training_sessions (held_on, title, place, branch_id) VALUES (?, ?, ?, ?)', [
      ctx.fields.held_on,
      String(ctx.fields.title || '通常稽古'),
      String(ctx.fields.place || ''),
      Number(ctx.fields.branch_id) || null,
    ]);
    redirect(ctx.res, `/attendance/${info.lastInsertRowid}`);
  });

  router.get('/attendance/:id', (ctx) => {
    requireAdmin(ctx);
    detailPage(ctx);
  });

  router.post('/attendance/:id', (ctx) => {
    const admin = requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const session = get('SELECT * FROM training_sessions WHERE id = ?', [id]);
    if (!session) throw new HttpError(404, '稽古が見つかりません');
    const autoStamp = ctx.fields.auto_stamp !== '0';
    let stamped = 0;

    tx(() => {
      run('UPDATE training_sessions SET note = ? WHERE id = ?', [String(ctx.fields.note || ''), id]);
      for (const [key, value] of Object.entries(ctx.fields)) {
        const m = /^s_(\d+)$/.exec(key);
        if (!m) continue;
        const memberId = Number(m[1]);
        const status = ['present', 'late', 'absent'].includes(value) ? value : 'present';
        run(
          `INSERT INTO attendance (session_id, member_id, status) VALUES (?, ?, ?)
           ON CONFLICT(session_id, member_id) DO UPDATE SET status = excluded.status`,
          [id, memberId, status],
        );

        // 出席・遅刻ならスタンプを 1 個押す。欠席に変えたら同じ稽古のスタンプを取り消す。
        if (!autoStamp) continue;
        if (status === 'absent') {
          voidStampForSession(memberId, id, admin.id);
        } else {
          const result = grantStamp({
            memberId,
            sessionId: id,
            reason: '稽古出席',
            grantedBy: admin.id,
            grantedOn: session.held_on,
          });
          if (result.created) stamped += 1;
        }
      }
    });
    const msg = autoStamp ? `出欠を保存し、${stamped} 名にスタンプを押しました` : '出欠を保存しました';
    redirect(ctx.res, `/attendance/${id}?msg=${encodeURIComponent(msg)}`);
  });
}
