import { all, get, run, tx } from '../db.js';
import { html, redirect, esc, HttpError } from '../http.js';
import { requireAdmin } from '../auth.js';
import { page, beltTag, bar, stat, stampCard, field, textInput, selectBox, yen } from '../views/layout.js';
import { listMembers, examReadiness } from '../domain.js';
import { branches, branchById, stampSummary, grantStamp, voidStamp, stampHistory, stampAuditLog } from '../stamps.js';

const REASONS = ['稽古出席', '大会参加', '他支部での稽古', '合宿参加', '演武会', 'その他（手入力）'];

function indexPage(ctx) {
  const branchList = branches();
  const branchId = ctx.query.get('branch') || '';
  const members = listMembers({ status: 'active', branchId });
  const today = new Date().toISOString().slice(0, 10);

  const rows = members.map((m) => ({ member: m, summary: stampSummary(m), readiness: examReadiness(m) }));
  const eligible = rows.filter((r) => r.summary.examEligible).length;
  const discounted = rows.filter((r) => r.summary.discountCards > 0);
  const totalDiscount = discounted.reduce((sum, r) => sum + r.summary.discountAmount, 0);
  // 割引を使う支部が 1 つも無ければ、割引まわりの表示は出さない
  const showDiscount = branchList.some((b) => b.discount_enabled);
  const stampedToday = get(
    "SELECT COUNT(*) AS c FROM stamps WHERE status = 'active' AND granted_on = date('now')",
  ).c;

  // 直近の稽古（未押印のものを先に出す）
  const sessions = all(
    `SELECT t.*, br.name AS branch_name,
      (SELECT COUNT(*) FROM stamps s WHERE s.session_id = t.id AND s.status = 'active') AS stamped,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = t.id AND a.status IN ('present','late')) AS present
     FROM training_sessions t LEFT JOIN branches br ON br.id = t.branch_id
     ORDER BY t.held_on DESC, t.id DESC LIMIT 10`,
  );

  const body = `
  <h1>スタンプカード</h1>
  <p class="sub">
    スタンプは<strong>指導者だけ</strong>が押せます。生徒側の画面に押印ボタンはありません。
    誰がいつ押したか・取り消したかはすべて記録されます。
  </p>

  <div class="chips">
    <a href="/stamps" class="${branchId === '' ? 'active' : ''}">全支部</a>
    ${branchList
      .map(
        (b) =>
          `<a href="/stamps?branch=${b.id}" class="${String(branchId) === String(b.id) ? 'active' : ''}">${esc(
            b.name,
          )}（${b.stamps_per_card}個で審査）</a>`,
      )
      .join('')}
  </div>

  <div class="grid cols-4">
    ${stat(rows.length, '対象の生徒')}
    ${stat(eligible, '審査を受けられる生徒')}
    ${stat(stampedToday, '今日押したスタンプ')}
    ${showDiscount ? stat(yen(totalDiscount), '割引合計') : stat(rows.reduce((s, r) => s + r.summary.earned, 0), '累計スタンプ')}
  </div>

  <div class="card">
    <h2 style="margin-top:0">稽古から一括で押す</h2>
    <p class="muted" style="margin-top:0;font-size:.9rem">
      出欠で「出席」「遅刻」にした生徒へまとめて 1 個ずつ押します。同じ稽古で二重に押されることはありません。
    </p>
    <div class="table-wrap"><table>
      <tr><th>日付</th><th>稽古</th><th>支部</th><th>出席</th><th>押印済み</th><th></th></tr>
      ${
        sessions.length
          ? sessions
              .map(
                (s) => `<tr>
        <td class="nowrap">${esc(s.held_on)}</td>
        <td><a href="/attendance/${s.id}">${esc(s.title)}</a></td>
        <td>${esc(s.branch_name || '—')}</td>
        <td>${s.present} 名</td>
        <td>${s.stamped} 名</td>
        <td class="right">
          <form method="post" action="/stamps/session/${s.id}" class="inline">
            <button class="small ${s.stamped >= s.present ? 'ghost' : ''}">
              ${s.stamped >= s.present && s.present > 0 ? '押印済み' : '出席者に押す'}
            </button>
          </form>
        </td>
      </tr>`,
              )
              .join('')
          : '<tr><td colspan="6" class="muted">稽古がまだありません。</td></tr>'
      }
    </table></div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">生徒を選んで押す</h2>
    <form method="post" action="/stamps/grant">
      <div class="row">
        ${field('日付', textInput('granted_on', today, { type: 'date', required: true }))}
        ${field('理由', selectBox('reason', REASONS.map((r) => [r, r]), '稽古出席'))}
        ${field('理由（その他の場合）', textInput('reason_other', ''))}
      </div>
      <div class="table-wrap" style="margin-top:.8rem"><table>
        <tr><th></th><th>生徒</th><th>支部</th><th>帯</th><th>台紙</th><th>累計</th></tr>
        ${rows
          .map(
            ({ member, summary }) => `<tr>
          <td><input type="checkbox" name="member_ids" value="${member.id}" style="width:auto"></td>
          <td><a href="/members/${member.id}">${esc(member.name)}</a></td>
          <td class="nowrap">${esc(member.branch_name || '—')}</td>
          <td>${beltTag(member.belt_name, member.belt_color)}</td>
          <td class="nowrap">${summary.progress} / ${summary.perCard}${
            summary.examEligible ? ' <span class="badge ok">審査可</span>' : ''
          }</td>
          <td class="nowrap">${summary.earned} 個${
            showDiscount && summary.discountCards
              ? ` <span class="badge warn">割引 ${yen(summary.discountAmount)}</span>`
              : ''
          }</td>
        </tr>`,
          )
          .join('')}
      </table></div>
      <button type="submit" style="margin-top:.75rem">チェックした生徒にスタンプを押す</button>
    </form>
  </div>

  ${
    !showDiscount
      ? ''
      : `<div class="card">
    <h2 style="margin-top:0">割引の状況</h2>
    ${
      discounted.length
        ? `<div class="table-wrap"><table>
          <tr><th>生徒</th><th>累計スタンプ</th><th>完了した台紙</th><th>割引段階</th><th class="right">割引額</th></tr>
          ${discounted
            .map(
              ({ member, summary }) => `<tr>
            <td><a href="/members/${member.id}">${esc(member.name)}</a></td>
            <td>${summary.earned} 個</td>
            <td>${summary.completedCards} 枚</td>
            <td>${summary.discountCards} 段階</td>
            <td class="right">${yen(summary.discountAmount)}</td>
          </tr>`,
            )
            .join('')}
        </table></div>
        <p class="muted" style="font-size:.85rem;margin-bottom:0">
          1 枚目の台紙は審査の受験資格になり、2 枚目以降が 1 枚ごとに割引 1 段階です。金額は支部設定で変えられます。
        </p>`
        : '<p class="muted">まだ割引対象の生徒はいません。</p>'
    }
  </div>`
  }

  <div class="card">
    <h2 style="margin-top:0">押印ログ（監査用）</h2>
    <div class="table-wrap"><table>
      <tr><th>日付</th><th>生徒</th><th>理由</th><th>押した人</th><th>状態</th><th></th></tr>
      ${stampAuditLog(40)
        .map(
          (s) => `<tr class="${s.status === 'void' ? 'locked' : ''}">
        <td class="nowrap">${esc(s.granted_on)}</td>
        <td>${esc(s.member_name)}</td>
        <td>${esc(s.reason)}</td>
        <td>${esc(s.granted_by_name || '—')}</td>
        <td>${
          s.status === 'active'
            ? '<span class="badge ok">有効</span>'
            : `<span class="badge">取消（${esc(s.voided_by_name || '—')}）</span>`
        }</td>
        <td class="right">${
          s.status === 'active'
            ? `<form method="post" action="/stamps/${s.id}/void" class="inline"
                 onsubmit="return confirm('このスタンプを取り消します。よろしいですか？')">
                <button class="ghost small">取り消す</button></form>`
            : ''
        }</td>
      </tr>`,
        )
        .join('')}
    </table></div>
  </div>`;

  html(ctx.res, page({ user: ctx.user, title: 'スタンプカード', active: '/stamps', body, flash: ctx.query.get('msg') }));
}

/** 生徒 1 人分のスタンプ台紙・履歴（カルテから開く） */
export function memberStampSection(member) {
  const summary = stampSummary(member);
  const history = stampHistory(member.id, 12);
  return `<div class="card">
    <h2 style="margin-top:0">スタンプカード</h2>
    <div class="stamp-meta">
      <span><b>${summary.progress}</b> / ${summary.perCard} 個（現在の台紙）</span>
      <span class="muted">累計 ${summary.earned} 個 ／ 完了 ${summary.completedCards} 枚</span>
      ${
        summary.examEligible
          ? '<span class="badge ok">審査を受けられます</span>'
          : `<span class="badge warn">審査まであと ${summary.remaining} 個</span>`
      }
      ${
        summary.discountEnabled && summary.discountCards
          ? `<span class="badge">割引 ${yen(summary.discountAmount)}</span>`
          : ''
      }
    </div>
    ${stampCard(summary)}
    <form method="post" action="/stamps/grant" class="row" style="margin-top:.5rem">
      <input type="hidden" name="member_ids" value="${member.id}">
      <input type="hidden" name="back" value="/members/${member.id}">
      ${field('日付', textInput('granted_on', new Date().toISOString().slice(0, 10), { type: 'date' }))}
      ${field('理由', textInput('reason_other', '', { placeholder: '大会参加 など' }))}
      <div class="field" style="flex:0 0 auto"><button class="small">スタンプを 1 個押す</button></div>
    </form>
    <div class="divider"></div>
    <div class="table-wrap"><table>
      <tr><th>日付</th><th>理由</th><th>押した人</th><th></th></tr>
      ${
        history.length
          ? history
              .map(
                (s) => `<tr class="${s.status === 'void' ? 'locked' : ''}">
          <td class="nowrap">${esc(s.granted_on)}</td>
          <td>${esc(s.reason)}${s.status === 'void' ? ' <span class="badge">取消</span>' : ''}</td>
          <td>${esc(s.granted_by_name || '—')}</td>
          <td class="right">${
            s.status === 'active'
              ? `<form method="post" action="/stamps/${s.id}/void" class="inline">
                  <input type="hidden" name="back" value="/members/${member.id}">
                  <button class="ghost small">取消</button></form>`
              : ''
          }</td>
        </tr>`,
              )
              .join('')
          : '<tr><td colspan="4" class="muted">まだスタンプがありません。</td></tr>'
      }
    </table></div>
  </div>`;
}

function settingsPage(ctx) {
  const branchList = branches();
  const body = `
  <h1>支部設定</h1>
  <p class="sub">スタンプの必要数・審査ルール・LINE 連携の可否は支部ごとに設定できます。</p>

  ${branchList
    .map((b) => {
      const memberCount = get("SELECT COUNT(*) AS c FROM members WHERE branch_id = ? AND status = 'active'", [b.id]).c;
      const linked = get(
        "SELECT COUNT(*) AS c FROM members WHERE branch_id = ? AND status = 'active' AND line_user_id <> ''",
        [b.id],
      ).c;
      const lineReady = b.line_enabled && b.line_token && b.line_secret;

      return `<div class="card">
    <h2 style="margin-top:0">${esc(b.name)} ${b.is_main ? '<span class="badge">本部</span>' : ''}</h2>
    <p class="sub" style="margin-bottom:.8rem">
      在籍 ${memberCount} 名 ／ 連絡手段：
      ${
        b.line_enabled
          ? lineReady
            ? `<strong>LINE + メール</strong>（LINE 連携済み ${linked} 名、残り ${
                memberCount - linked
              } 名はメール）`
            : '<span class="badge warn">LINE を「使う」にしていますが、トークン／シークレットが未入力です</span>'
          : '<strong>メールのみ</strong>'
      }
    </p>
    <form method="post" action="/branches/${b.id}">
      <div class="row">
        ${field('支部名', textInput('name', b.name, { required: true }))}
        ${field('台紙 1 枚のスタンプ数', textInput('stamps_per_card', b.stamps_per_card, { type: 'number' }))}
        ${field(
          '審査の判定ルール',
          selectBox(
            'exam_rule',
            [
              ['stamp', 'スタンプがたまったら受験可（本部方式）'],
              ['stamp_skill', 'スタンプ＋習熟度 80%'],
              ['criteria', '出席回数・在籍期間・習熟度の 3 条件'],
            ],
            b.exam_rule,
          ),
        )}
        ${field(
          '昇級後のスタンプ',
          selectBox('reset_on_promotion', [[1, '数え直す（次の審査用にリセット）'], [0, '通算のまま']], b.reset_on_promotion),
        )}
      </div>

      <div class="divider"></div>
      <h3 style="font-size:.95rem;margin:.2rem 0 .6rem">LINE 連携</h3>
      <p class="muted" style="font-size:.85rem;margin-top:0">
        「使う」に切り替えるだけで、この支部の連絡が LINE 優先に変わります（未連携の生徒はメールのまま）。
        提携先の準備ができてから切り替えてください。
      </p>
      <div class="row">
        ${field('この支部で LINE を', selectBox('line_enabled', [[0, '使わない（メールのみ）'], [1, '使う']], b.line_enabled))}
        ${field('チャネルアクセストークン', textInput('line_token', b.line_token, { type: 'password' }))}
        ${field('チャネルシークレット', textInput('line_secret', b.line_secret, { type: 'password' }))}
      </div>

      <div class="divider"></div>
      <h3 style="font-size:.95rem;margin:.2rem 0 .6rem">スタンプによる月謝割引（任意）</h3>
      <p class="muted" style="font-size:.85rem;margin-top:0">
        審査料を現金で徴収する運用なら「使わない」のままで構いません。使う場合だけ、
        台紙 2 枚目以降 1 枚ごとに割引が 1 段階増えます。
      </p>
      <div class="row">
        ${field('割引を', selectBox('discount_enabled', [[0, '使わない'], [1, '使う']], b.discount_enabled))}
        ${field('台紙 1 枚あたりの割引額（円）', textInput('discount_per_card', b.discount_per_card, { type: 'number' }))}
        ${field('割引段階の上限', textInput('discount_max_cards', b.discount_max_cards, { type: 'number' }))}
      </div>

      <div class="field" style="margin-top:.75rem">
        <label>メモ</label>${textInput('note', b.note, { placeholder: '例）名西支部は提携先の都合で LINE 連携なし。' })}
      </div>
      <button type="submit" style="margin-top:.5rem">保存</button>
    </form>
  </div>`;
    })
    .join('')}

  <div class="card">
    <h2 style="margin-top:0">支部を追加</h2>
    <form method="post" action="/branches">
      <div class="row">
        ${field('支部名', textInput('name', '', { required: true }))}
        ${field('台紙 1 枚のスタンプ数', textInput('stamps_per_card', '30', { type: 'number' }))}
        <div class="field" style="flex:0 0 auto"><button type="submit">追加</button></div>
      </div>
      <p class="muted" style="font-size:.85rem;margin-bottom:0">
        追加した支部は「メールのみ・割引なし」で始まります。LINE や割引はあとから切り替えられます。
      </p>
    </form>
  </div>`;

  html(ctx.res, page({ user: ctx.user, title: '支部設定', active: '/branches', body, flash: ctx.query.get('msg') }));
}

export function register(router) {
  router.get('/stamps', (ctx) => {
    requireAdmin(ctx);
    indexPage(ctx);
  });

  // 稽古の出席者にまとめて押す
  router.post('/stamps/session/:id', (ctx) => {
    const admin = requireAdmin(ctx);
    const sessionId = Number(ctx.params.id);
    const session = get('SELECT * FROM training_sessions WHERE id = ?', [sessionId]);
    if (!session) throw new HttpError(404, '稽古が見つかりません');

    const attendees = all(
      "SELECT member_id FROM attendance WHERE session_id = ? AND status IN ('present','late')",
      [sessionId],
    );
    let count = 0;
    tx(() => {
      for (const row of attendees) {
        const result = grantStamp({
          memberId: row.member_id,
          sessionId,
          reason: '稽古出席',
          grantedBy: admin.id,
          grantedOn: session.held_on,
        });
        if (result.created) count += 1;
      }
    });
    redirect(ctx.res, `/stamps?msg=${encodeURIComponent(`${count} 名にスタンプを押しました`)}`);
  });

  // 生徒を選んで押す
  router.post('/stamps/grant', (ctx) => {
    const admin = requireAdmin(ctx);
    const ids = [].concat(ctx.fields.member_ids ?? []).map(Number).filter(Boolean);
    if (!ids.length) throw new HttpError(400, '生徒が選ばれていません');
    const other = String(ctx.fields.reason_other || '').trim();
    const selected = String(ctx.fields.reason || '');
    const reason = other || (selected.startsWith('その他') ? 'その他' : selected) || '稽古出席';
    const grantedOn = ctx.fields.granted_on || null;

    tx(() => {
      for (const memberId of ids) {
        grantStamp({ memberId, reason, grantedBy: admin.id, grantedOn });
      }
    });
    const back = String(ctx.fields.back || '/stamps');
    redirect(ctx.res, `${back}?msg=${encodeURIComponent(`${ids.length} 名にスタンプを押しました`)}`);
  });

  router.post('/stamps/:id/void', (ctx) => {
    const admin = requireAdmin(ctx);
    voidStamp(Number(ctx.params.id), admin.id, String(ctx.fields.reason || '指導者による取り消し'));
    const back = String(ctx.fields.back || '/stamps');
    redirect(ctx.res, `${back}?msg=${encodeURIComponent('スタンプを取り消しました')}`);
  });

  router.get('/branches', (ctx) => {
    requireAdmin(ctx);
    settingsPage(ctx);
  });

  router.post('/branches', (ctx) => {
    requireAdmin(ctx);
    const name = String(ctx.fields.name || '').trim();
    if (!name) throw new HttpError(400, '支部名は必須です');
    run('INSERT INTO branches (name, stamps_per_card) VALUES (?, ?)', [
      name,
      Number(ctx.fields.stamps_per_card) || 30,
    ]);
    redirect(ctx.res, `/branches?msg=${encodeURIComponent('支部を追加しました')}`);
  });

  router.post('/branches/:id', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const branch = branchById(id);
    if (!branch) throw new HttpError(404, '支部が見つかりません');
    const f = ctx.fields;
    const rule = ['stamp', 'stamp_skill', 'criteria'].includes(f.exam_rule) ? f.exam_rule : 'stamp';
    run(
      `UPDATE branches SET name = ?, stamps_per_card = ?, discount_enabled = ?, discount_per_card = ?,
              discount_max_cards = ?, exam_rule = ?, reset_on_promotion = ?, line_enabled = ?,
              line_token = ?, line_secret = ?, note = ?
       WHERE id = ?`,
      [
        String(f.name || branch.name).trim(),
        Math.max(1, Number(f.stamps_per_card) || 30),
        Number(f.discount_enabled) ? 1 : 0,
        Math.max(0, Number(f.discount_per_card) || 0),
        Math.max(0, Number(f.discount_max_cards) || 0),
        rule,
        Number(f.reset_on_promotion) ? 1 : 0,
        Number(f.line_enabled) ? 1 : 0,
        String(f.line_token ?? branch.line_token),
        String(f.line_secret ?? branch.line_secret),
        String(f.note || ''),
        id,
      ],
    );
    redirect(ctx.res, `/branches?msg=${encodeURIComponent('保存しました')}`);
  });
}
