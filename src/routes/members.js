import { all, get, run, tx } from '../db.js';
import { html, redirect, esc, HttpError } from '../http.js';
import { requireAdmin, hashPassword } from '../auth.js';
import { page, beltTag, bar, field, textInput, selectBox, stat, yen } from '../views/layout.js';
import { belts, listMembers, memberWithBelt, examReadiness, memberPoints, nextBelt, beltById } from '../domain.js';
import { branches, branchOf } from '../stamps.js';
import { issueLinkCode, unlink } from '../line.js';
import { memberStampSection } from './stamps.js';

const STATUS_LABEL = { active: '在籍', rest: '休会', left: '退会' };
const PLAN_LABEL = { standard: '通常', premium: 'プレミアム' };
const LEVEL_LABEL = ['未着手', '練習中', 'できる', '審査合格レベル'];

function memberForm(member = {}, beltList) {
  return `
  <div class="row">
    ${field('氏名', textInput('name', member.name, { required: true }))}
    ${field('ふりがな', textInput('kana', member.kana))}
    ${field('生年月日', textInput('birthday', member.birthday, { type: 'date' }))}
  </div>
  <div class="row" style="margin-top:.75rem">
    ${field('帯', selectBox('belt_id', beltList.map((b) => [b.id, b.name]), member.belt_id))}
    ${field('入会日', textInput('joined_on', member.joined_on || new Date().toISOString().slice(0, 10), { type: 'date', required: true }))}
    ${field('昇級・昇段日', textInput('last_promoted_on', member.last_promoted_on, { type: 'date' }))}
  </div>
  <div class="row" style="margin-top:.75rem">
    ${field('メールアドレス', textInput('email', member.email, { type: 'email' }))}
    ${field('電話番号', textInput('phone', member.phone))}
    ${field('保護者氏名', textInput('guardian_name', member.guardian_name))}
  </div>
  <div class="row" style="margin-top:.75rem">
    ${field('支部', selectBox('branch_id', branches().map((b) => [b.id, b.name]), member.branch_id))}
    ${field('会員プラン', selectBox('plan', Object.entries(PLAN_LABEL), member.plan || 'standard'))}
    ${field('在籍状況', selectBox('status', Object.entries(STATUS_LABEL), member.status || 'active'))}
    ${field(
      '連絡方法',
      selectBox(
        'notify_channel',
        [['auto', '自動（LINE 連携済みなら LINE）'], ['email', 'メールのみ'], ['line', 'LINE のみ']],
        member.notify_channel || 'auto',
      ),
    )}
  </div>
  <div class="field" style="margin-top:.75rem">
    <label>メモ</label><textarea name="notes" style="min-height:5rem">${esc(member.notes || '')}</textarea>
  </div>`;
}

function indexPage(ctx) {
  const beltList = belts();
  const branchList = branches();
  const status = ctx.query.get('status') ?? 'active';
  const beltId = ctx.query.get('belt') ?? '';
  const branchId = ctx.query.get('branch') ?? '';
  const keyword = ctx.query.get('q') ?? '';
  const rows = listMembers({ status, beltId, branchId, keyword });

  const body = `
  <h1>生徒名簿</h1>
  <p class="sub">在籍状況・帯・審査対象かどうかを一覧で確認できます。</p>

  <form method="get" action="/members" class="card">
    <div class="row">
      ${field('キーワード', textInput('q', keyword, { placeholder: '氏名・ふりがな・メール' }))}
      ${field('支部', selectBox('branch', branchList.map((b) => [b.id, b.name]), branchId, { blank: 'すべて' }))}
      ${field('帯', selectBox('belt', beltList.map((b) => [b.id, b.name]), beltId, { blank: 'すべて' }))}
      ${field('在籍状況', selectBox('status', Object.entries(STATUS_LABEL), status, { blank: 'すべて' }))}
      <div class="field" style="flex:0 0 auto"><button type="submit">絞り込む</button></div>
    </div>
  </form>

  <div class="card">
    <div class="table-wrap"><table>
      <tr><th>氏名</th><th>支部</th><th>帯</th><th>在籍</th><th>スタンプ</th><th>割引</th><th>審査</th><th></th></tr>
      ${
        rows.length
          ? rows
              .map((m) => {
                const r = examReadiness(m);
                return `<tr>
        <td><a href="/members/${m.id}">${esc(m.name)}</a><br><span class="muted" style="font-size:.8rem">${esc(
          m.kana,
        )}</span></td>
        <td class="nowrap">${esc(m.branch_name || '—')}</td>
        <td>${beltTag(m.belt_name, m.belt_color)}</td>
        <td><span class="badge">${esc(STATUS_LABEL[m.status] || m.status)}</span></td>
        <td class="nowrap">${r.stamps.progress} / ${r.stamps.perCard}<br>
          <span class="muted" style="font-size:.8rem">累計 ${r.stamps.earned}</span></td>
        <td class="nowrap">${r.stamps.discountCards ? yen(r.stamps.discountAmount) : '—'}</td>
        <td style="min-width:120px">${
          r.ready ? '<span class="badge ok">対象</span>' : bar(r.progress)
        }</td>
        <td class="right"><a class="btn small ghost" href="/members/${m.id}">カルテ</a></td>
      </tr>`;
              })
              .join('')
          : '<tr><td colspan="8" class="muted">該当する生徒がいません。</td></tr>'
      }
    </table></div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">生徒を追加</h2>
    <form method="post" action="/members">
      ${memberForm({}, beltList)}
      <button type="submit" style="margin-top:.75rem">登録する</button>
    </form>
  </div>`;

  html(ctx.res, page({ user: ctx.user, title: '生徒名簿', active: '/members', body, flash: ctx.query.get('msg') }));
}

function detailPage(ctx) {
  const member = memberWithBelt(Number(ctx.params.id));
  if (!member) throw new HttpError(404, '生徒が見つかりません');
  const beltList = belts();
  const readiness = examReadiness(member);

  const skillItems = all('SELECT * FROM skill_items WHERE belt_id = ? ORDER BY sort_no, id', [member.belt_id]);
  const levels = new Map(
    all('SELECT * FROM assessments WHERE member_id = ?', [member.id]).map((a) => [a.skill_item_id, a]),
  );

  const attendance = all(
    `SELECT t.held_on, t.title, a.status FROM attendance a
     JOIN training_sessions t ON t.id = a.session_id
     WHERE a.member_id = ? ORDER BY t.held_on DESC LIMIT 12`,
    [member.id],
  );

  const videos = all('SELECT * FROM video_submissions WHERE member_id = ? ORDER BY id DESC LIMIT 5', [member.id]);
  const account = member.user_id ? get('SELECT * FROM users WHERE id = ?', [member.user_id]) : null;
  const next = nextBelt(beltById(member.belt_id));
  const lineBranch = branchOf(member);

  const body = `
  <h1>${esc(member.name)} <span class="muted" style="font-size:1rem">${esc(member.kana)}</span></h1>
  <p class="sub">${beltTag(member.belt_name, member.belt_color)} ／ ${esc(member.branch_name || '支部未設定')}
    ／ 入会 ${esc(member.joined_on)} ／ ${esc(STATUS_LABEL[member.status] || member.status)}
    ${readiness.stamps.discountCards ? ` ／ 月謝割引 ${yen(readiness.stamps.discountAmount)}` : ''}</p>

  <div class="grid cols-4">
    ${stat(`${readiness.stamps.progress} / ${readiness.stamps.perCard}`, 'スタンプ（現在の台紙）')}
    ${stat(readiness.stamps.earned, '累計スタンプ')}
    ${stat(`${readiness.clearedSkills}/${readiness.totalSkills}`, '習得済みの技術項目')}
    ${stat(readiness.ready ? '対象' : '準備中', '次回審査')}
  </div>

  ${memberStampSection(member)}

  <div class="grid cols-2">
    <div class="card">
      <h2 style="margin-top:0">審査判定</h2>
      ${bar(readiness.progress)}
      <div class="table-wrap" style="margin-top:.7rem"><table>
        ${readiness.checks
          .map(
            (c) =>
              `<tr><td class="nowrap">${esc(c.label)}</td><td>${esc(c.detail)}</td><td class="right">${
                c.ok ? '<span class="badge ok">OK</span>' : '<span class="badge warn">未達</span>'
              }</td></tr>`,
          )
          .join('')}
      </table></div>
      <div class="divider"></div>
      <form method="post" action="/members/${member.id}/flag" class="inline">
        <input type="hidden" name="value" value="${member.exam_flag ? 0 : 1}">
        <button class="ghost small">${member.exam_flag ? '手動指定を解除' : '審査対象に手動指定'}</button>
      </form>
      ${
        next
          ? `<form method="post" action="/members/${member.id}/promote" class="inline"
                onsubmit="return confirm('${esc(next.name)}に昇級（昇段）として記録します。よろしいですか？')">
              <button class="small">${esc(next.name)}に昇級を記録</button>
            </form>`
          : '<span class="muted">最上位の帯です。</span>'
      }
    </div>

    <div class="card">
      <h2 style="margin-top:0">LINE 連携</h2>
      ${
        !lineBranch?.line_enabled
          ? `<p class="muted">${esc(lineBranch?.name ?? '所属支部')}は LINE 連携を使わない設定です。連絡はメールで届きます。</p>
             <a class="btn ghost small" href="/branches">支部設定を開く</a>`
          : member.line_user_id
            ? `<p><span class="badge ok">連携済み</span> 連絡は LINE に届きます。</p>
               <form method="post" action="/members/${member.id}/line/unlink" class="inline">
                 <button class="ghost small">連携を解除</button></form>`
            : `<p class="muted">生徒が道場の LINE 公式アカウントに 6 桁の連携コードを送ると紐づきます。</p>
               ${
                 member.line_link_code
                   ? `<p>連携コード：<strong style="font-size:1.3rem;letter-spacing:.2em">${esc(
                       member.line_link_code,
                     )}</strong></p>`
                   : ''
               }
               <form method="post" action="/members/${member.id}/line/code" class="inline">
                 <button class="small">連携コードを発行</button></form>`
      }
    </div>

    <div class="card">
      <h2 style="margin-top:0">ログインアカウント</h2>
      ${
        account
          ? `<p>${esc(account.email)} <span class="badge">${
              account.role === 'admin' ? '指導者' : '会員'
            }</span></p>
             <form method="post" action="/members/${member.id}/account">
               ${field('パスワードを再設定', textInput('password', '', { type: 'password', placeholder: '8文字以上' }))}
               <button class="ghost small">更新する</button>
             </form>`
          : `<p class="muted">まだアカウントがありません。会員サイトにログインできるようにします。</p>
             <form method="post" action="/members/${member.id}/account">
               ${field('メールアドレス', textInput('email', member.email, { type: 'email', required: true }))}
               ${field('初期パスワード', textInput('password', '', { type: 'password', required: true }))}
               <button class="small">アカウントを作成</button>
             </form>`
      }
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">習熟度（${esc(member.belt_name)}の課題）</h2>
    ${
      skillItems.length
        ? `<form method="post" action="/members/${member.id}/skills">
            <div class="table-wrap"><table>
              <tr><th>分類</th><th>項目</th><th>習熟度</th><th>メモ</th></tr>
              ${skillItems
                .map((s) => {
                  const a = levels.get(s.id);
                  return `<tr>
                  <td class="nowrap"><span class="badge">${esc(s.category)}</span></td>
                  <td>${esc(s.name)}</td>
                  <td style="min-width:150px">${selectBox(
                    `level_${s.id}`,
                    LEVEL_LABEL.map((l, i) => [i, `${i}: ${l}`]),
                    a?.level ?? 0,
                  )}</td>
                  <td>${textInput(`comment_${s.id}`, a?.comment ?? '')}</td>
                </tr>`;
                })
                .join('')}
            </table></div>
            <button type="submit" style="margin-top:.75rem">習熟度を保存</button>
          </form>`
        : '<p class="muted">この帯の技術項目が未登録です。</p>'
    }
  </div>

  <div class="grid cols-2">
    <div class="card">
      <h2 style="margin-top:0">出欠履歴</h2>
      <div class="table-wrap"><table>
        ${
          attendance.length
            ? attendance
                .map(
                  (a) =>
                    `<tr><td class="nowrap">${esc(a.held_on)}</td><td>${esc(a.title)}</td><td class="right">${
                      a.status === 'present'
                        ? '<span class="badge ok">出席</span>'
                        : a.status === 'late'
                          ? '<span class="badge warn">遅刻</span>'
                          : '<span class="badge">欠席</span>'
                    }</td></tr>`,
                )
                .join('')
            : '<tr><td class="muted">記録がありません。</td></tr>'
        }
      </table></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">提出された動画</h2>
      <ul class="list-reset">
        ${
          videos.length
            ? videos
                .map(
                  (v) =>
                    `<li style="padding:.35rem 0;border-bottom:1px solid var(--line)"><a href="/videos/${v.id}">${esc(
                      v.title,
                    )}</a> ${
                      v.status === 'pending'
                        ? '<span class="badge warn">未添削</span>'
                        : '<span class="badge ok">添削済</span>'
                    }<br><span class="muted">${esc(v.created_at)}</span></li>`,
                )
                .join('')
            : '<li class="muted">まだありません。</li>'
        }
      </ul>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">基本情報の編集</h2>
    <form method="post" action="/members/${member.id}">
      ${memberForm(member, beltList)}
      <button type="submit" style="margin-top:.75rem">保存する</button>
    </form>
  </div>`;

  html(ctx.res, page({ user: ctx.user, title: member.name, active: '/members', body, flash: ctx.query.get('msg') }));
}

function fromFields(f) {
  return [
    String(f.name || '').trim(),
    String(f.kana || '').trim(),
    f.birthday || null,
    Number(f.belt_id),
    f.joined_on,
    f.last_promoted_on || null,
    String(f.phone || ''),
    String(f.email || ''),
    String(f.guardian_name || ''),
    f.plan === 'premium' ? 'premium' : 'standard',
    ['active', 'rest', 'left'].includes(f.status) ? f.status : 'active',
    String(f.notes || ''),
    Number(f.branch_id) || null,
    ['auto', 'email', 'line'].includes(f.notify_channel) ? f.notify_channel : 'auto',
  ];
}

export function register(router) {
  router.get('/members', (ctx) => {
    requireAdmin(ctx);
    indexPage(ctx);
  });

  router.post('/members', (ctx) => {
    requireAdmin(ctx);
    const values = fromFields(ctx.fields);
    if (!values[0]) throw new HttpError(400, '氏名は必須です');
    const info = run(
      `INSERT INTO members (name, kana, birthday, belt_id, joined_on, last_promoted_on, phone, email,
                            guardian_name, plan, status, notes, branch_id, notify_channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values,
    );
    redirect(ctx.res, `/members/${info.lastInsertRowid}?msg=${encodeURIComponent('生徒を登録しました')}`);
  });

  router.get('/members/:id', (ctx) => {
    requireAdmin(ctx);
    detailPage(ctx);
  });

  router.post('/members/:id', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    run(
      `UPDATE members SET name = ?, kana = ?, birthday = ?, belt_id = ?, joined_on = ?, last_promoted_on = ?,
              phone = ?, email = ?, guardian_name = ?, plan = ?, status = ?, notes = ?, branch_id = ?,
              notify_channel = ? WHERE id = ?`,
      [...fromFields(ctx.fields), id],
    );
    redirect(ctx.res, `/members/${id}?msg=${encodeURIComponent('保存しました')}`);
  });

  router.post('/members/:id/skills', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    tx(() => {
      for (const [key, value] of Object.entries(ctx.fields)) {
        const m = /^level_(\d+)$/.exec(key);
        if (!m) continue;
        const skillId = Number(m[1]);
        const level = Math.max(0, Math.min(3, Number(value) || 0));
        const comment = String(ctx.fields[`comment_${skillId}`] || '');
        run(
          `INSERT INTO assessments (member_id, skill_item_id, level, comment, assessed_on)
           VALUES (?, ?, ?, ?, date('now'))
           ON CONFLICT(member_id, skill_item_id)
           DO UPDATE SET level = excluded.level, comment = excluded.comment, assessed_on = excluded.assessed_on`,
          [id, skillId, level, comment],
        );
      }
    });
    redirect(ctx.res, `/members/${id}?msg=${encodeURIComponent('習熟度を保存しました')}`);
  });

  router.post('/members/:id/flag', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    run('UPDATE members SET exam_flag = ? WHERE id = ?', [Number(ctx.fields.value) ? 1 : 0, id]);
    redirect(ctx.res, `/members/${id}?msg=${encodeURIComponent('審査対象の指定を更新しました')}`);
  });

  router.post('/members/:id/promote', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const member = get('SELECT * FROM members WHERE id = ?', [id]);
    if (!member) throw new HttpError(404, '生徒が見つかりません');
    const next = nextBelt(beltById(member.belt_id));
    if (!next) throw new HttpError(400, 'これ以上の帯がありません');
    run("UPDATE members SET belt_id = ?, last_promoted_on = date('now'), exam_flag = 0 WHERE id = ?", [next.id, id]);
    redirect(ctx.res, `/members/${id}?msg=${encodeURIComponent(`${next.name}への昇級を記録しました`)}`);
  });

  router.post('/members/:id/line/code', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const code = issueLinkCode(id);
    redirect(ctx.res, `/members/${id}?msg=${encodeURIComponent(`連携コード ${code} を発行しました`)}`);
  });

  router.post('/members/:id/line/unlink', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    unlink(id);
    redirect(ctx.res, `/members/${id}?msg=${encodeURIComponent('LINE 連携を解除しました')}`);
  });

  router.post('/members/:id/account', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const member = get('SELECT * FROM members WHERE id = ?', [id]);
    if (!member) throw new HttpError(404, '生徒が見つかりません');
    const password = String(ctx.fields.password || '');
    if (password.length < 8) throw new HttpError(400, 'パスワードは 8 文字以上にしてください');

    if (member.user_id) {
      run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), member.user_id]);
    } else {
      const email = String(ctx.fields.email || '').trim().toLowerCase();
      if (!email) throw new HttpError(400, 'メールアドレスを入力してください');
      if (get('SELECT id FROM users WHERE lower(email) = ?', [email])) {
        throw new HttpError(400, 'そのメールアドレスは既に使われています');
      }
      const info = run(
        "INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, 'member', ?)",
        [email, hashPassword(password), member.name],
      );
      run('UPDATE members SET user_id = ?, email = COALESCE(NULLIF(email, \'\'), ?) WHERE id = ?', [
        info.lastInsertRowid,
        email,
        id,
      ]);
    }
    redirect(ctx.res, `/members/${id}?msg=${encodeURIComponent('ログインアカウントを更新しました')}`);
  });
}
