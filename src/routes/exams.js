import { all, get, run, tx } from '../db.js';
import { html, redirect, esc, HttpError } from '../http.js';
import { requireAdmin } from '../auth.js';
import { page, beltTag, bar, field, textInput, selectBox } from '../views/layout.js';
import { belts, examCandidates, examReadiness, memberWithBelt, nextBelt, beltById } from '../domain.js';
import { queueNotification, renderTemplate, mailVars } from '../mail.js';

const DECISION_LABEL = {
  pending: '未判定',
  passed: '合格',
  failed: '不合格',
  declined: '辞退',
};

function indexPage(ctx) {
  const candidates = examCandidates();
  const exams = all(
    `SELECT e.*, (SELECT COUNT(*) FROM exam_candidates c WHERE c.exam_id = e.id) AS n
     FROM exams e ORDER BY e.held_on DESC`,
  );

  const body = `
  <h1>審査管理</h1>
  <p class="sub">支部の判定ルール（既定はスタンプカード 1 枚）にもとづいて、次回審査の対象者を自動で抽出します。</p>

  <div class="card">
    <h2 style="margin-top:0">次回審査の対象候補（${candidates.length} 名）</h2>
    ${
      candidates.length
        ? `<div class="table-wrap"><table>
            <tr><th>生徒</th><th>現在</th><th>次の帯</th><th>スタンプ</th><th>習熟度</th><th>達成度</th></tr>
            ${candidates
              .map(
                ({ member, readiness }) => `<tr>
              <td><a href="/members/${member.id}">${esc(member.name)}</a></td>
              <td>${beltTag(readiness.belt?.name, readiness.belt?.color)}</td>
              <td>${beltTag(readiness.nextBelt?.name ?? '—', readiness.nextBelt?.color)}</td>
              <td class="nowrap">${readiness.stamps.examStamps} / ${readiness.stamps.perCard}</td>
              <td class="nowrap">${readiness.clearedSkills}/${readiness.totalSkills}</td>
              <td style="min-width:110px">${bar(readiness.progress)}</td>
            </tr>`,
              )
              .join('')}
          </table></div>`
        : '<p class="muted">現在、条件を満たしている生徒はいません。</p>'
    }
  </div>

  <div class="card">
    <h2 style="margin-top:0">審査会を作成</h2>
    <form method="post" action="/exams">
      <div class="row">
        ${field('名称', textInput('name', `${new Date().getFullYear()}年 昇級審査`, { required: true }))}
        ${field('実施日', textInput('held_on', '', { type: 'date', required: true }))}
        ${field('場所', textInput('place', ''))}
        <div class="field" style="flex:0 0 auto"><button type="submit">作成</button></div>
      </div>
    </form>
  </div>

  <div class="card">
    <h2 style="margin-top:0">審査会一覧</h2>
    <div class="table-wrap"><table>
      <tr><th>実施日</th><th>名称</th><th>場所</th><th>受審者</th><th></th></tr>
      ${
        exams.length
          ? exams
              .map(
                (e) => `<tr>
        <td class="nowrap">${esc(e.held_on)}</td>
        <td><a href="/exams/${e.id}">${esc(e.name)}</a></td>
        <td>${esc(e.place)}</td>
        <td>${e.n} 名</td>
        <td class="right"><a class="btn small ghost" href="/exams/${e.id}">管理</a></td>
      </tr>`,
              )
              .join('')
          : '<tr><td colspan="5" class="muted">まだ審査会がありません。</td></tr>'
      }
    </table></div>
  </div>`;

  html(ctx.res, page({ user: ctx.user, title: '審査管理', active: '/exams', body, flash: ctx.query.get('msg') }));
}

function detailPage(ctx) {
  const id = Number(ctx.params.id);
  const exam = get('SELECT * FROM exams WHERE id = ?', [id]);
  if (!exam) throw new HttpError(404, '審査会が見つかりません');
  const beltList = belts();

  const entries = all(
    `SELECT c.*, m.name, m.kana, b.name AS belt_name, b.color AS belt_color
     FROM exam_candidates c
     JOIN members m ON m.id = c.member_id
     JOIN belts b ON b.id = m.belt_id
     WHERE c.exam_id = ? ORDER BY b.rank_order DESC, m.kana`,
    [id],
  );
  const entered = new Set(entries.map((e) => e.member_id));
  const candidates = examCandidates().filter(({ member }) => !entered.has(member.id));

  const body = `
  <h1>${esc(exam.name)}</h1>
  <p class="sub">${esc(exam.held_on)} ／ ${esc(exam.place || '会場未定')}</p>

  <div class="card">
    <h2 style="margin-top:0">受審者（${entries.length} 名）</h2>
    ${
      entries.length
        ? `<div class="table-wrap"><table>
          <tr><th>生徒</th><th>現在の帯</th><th>受審する帯</th><th>結果</th><th></th></tr>
          ${entries
            .map(
              (e) => `<tr>
            <td><a href="/members/${e.member_id}">${esc(e.name)}</a></td>
            <td>${beltTag(e.belt_name, e.belt_color)}</td>
            <td>${esc(beltById(e.target_belt_id)?.name ?? '—')}</td>
            <td><span class="badge ${e.decision === 'passed' ? 'ok' : e.decision === 'pending' ? '' : 'warn'}">${esc(
              DECISION_LABEL[e.decision],
            )}</span></td>
            <td class="right">
              <form method="post" action="/exams/${id}/decision" class="inline">
                <input type="hidden" name="member_id" value="${e.member_id}">
                ${selectBox('decision', Object.entries(DECISION_LABEL), e.decision)}
                <button class="small ghost">更新</button>
              </form>
            </td>
          </tr>`,
            )
            .join('')}
        </table></div>
        <p class="muted" style="font-size:.85rem;margin-bottom:0">「合格」に更新すると、その生徒の帯が受審帯に繰り上がり、昇級日が今日の日付で記録されます。</p>
        <form method="post" action="/exams/${id}/mail" style="margin-top:.8rem">
          <button class="ghost small">受審者に案内メールを作成（下書きキューへ）</button>
        </form>`
        : '<p class="muted">まだ受審者がいません。</p>'
    }
  </div>

  <div class="card">
    <h2 style="margin-top:0">条件を満たす生徒を追加</h2>
    ${
      candidates.length
        ? `<form method="post" action="/exams/${id}/add">
          <div class="table-wrap"><table>
            <tr><th></th><th>生徒</th><th>現在</th><th>受審する帯</th></tr>
            ${candidates
              .map(
                ({ member, readiness }) => `<tr>
              <td><input type="checkbox" name="member_ids" value="${member.id}" style="width:auto" checked></td>
              <td>${esc(member.name)}</td>
              <td>${beltTag(readiness.belt?.name, readiness.belt?.color)}</td>
              <td>${selectBox(
                `target_${member.id}`,
                beltList.map((b) => [b.id, b.name]),
                readiness.nextBelt?.id ?? '',
              )}</td>
            </tr>`,
              )
              .join('')}
          </table></div>
          <button type="submit" style="margin-top:.75rem">選択した生徒を受審者に追加</button>
        </form>`
        : '<p class="muted">追加できる候補者はいません。</p>'
    }
  </div>`;

  html(ctx.res, page({ user: ctx.user, title: exam.name, active: '/exams', body, flash: ctx.query.get('msg') }));
}

export function register(router) {
  router.get('/exams', (ctx) => {
    requireAdmin(ctx);
    indexPage(ctx);
  });

  router.post('/exams', (ctx) => {
    requireAdmin(ctx);
    const info = run('INSERT INTO exams (name, held_on, place) VALUES (?, ?, ?)', [
      String(ctx.fields.name || '昇級審査'),
      ctx.fields.held_on,
      String(ctx.fields.place || ''),
    ]);
    redirect(ctx.res, `/exams/${info.lastInsertRowid}`);
  });

  router.get('/exams/:id', (ctx) => {
    requireAdmin(ctx);
    detailPage(ctx);
  });

  router.post('/exams/:id/add', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const ids = [].concat(ctx.fields.member_ids ?? []);
    tx(() => {
      for (const raw of ids) {
        const memberId = Number(raw);
        if (!memberId) continue;
        const target = Number(ctx.fields[`target_${memberId}`]) || null;
        run(
          `INSERT INTO exam_candidates (exam_id, member_id, target_belt_id) VALUES (?, ?, ?)
           ON CONFLICT(exam_id, member_id) DO UPDATE SET target_belt_id = excluded.target_belt_id`,
          [id, memberId, target],
        );
      }
    });
    redirect(ctx.res, `/exams/${id}?msg=${encodeURIComponent('受審者を追加しました')}`);
  });

  router.post('/exams/:id/decision', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const memberId = Number(ctx.fields.member_id);
    const decision = Object.keys(DECISION_LABEL).includes(ctx.fields.decision) ? ctx.fields.decision : 'pending';
    const row = get('SELECT * FROM exam_candidates WHERE exam_id = ? AND member_id = ?', [id, memberId]);
    if (!row) throw new HttpError(404, '受審者が見つかりません');

    tx(() => {
      run('UPDATE exam_candidates SET decision = ? WHERE id = ?', [decision, row.id]);
      if (decision === 'passed') {
        const member = get('SELECT * FROM members WHERE id = ?', [memberId]);
        const targetId = row.target_belt_id || nextBelt(beltById(member.belt_id))?.id;
        if (targetId) {
          run("UPDATE members SET belt_id = ?, last_promoted_on = date('now'), exam_flag = 0 WHERE id = ?", [
            targetId,
            memberId,
          ]);
        }
      }
    });
    redirect(ctx.res, `/exams/${id}?msg=${encodeURIComponent('結果を更新しました')}`);
  });

  router.post('/exams/:id/mail', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const exam = get('SELECT * FROM exams WHERE id = ?', [id]);
    const rows = all(
      `SELECT m.* FROM exam_candidates c JOIN members m ON m.id = c.member_id WHERE c.exam_id = ?`,
      [id],
    );
    const subject = `【${exam.name}】受審のご案内`;
    const template = `{{name}} 様

このたび、{{name}} さんを {{next_exam}} の受審対象といたしました。
現在の帯：{{belt}}

日時：${exam.held_on}
会場：${exam.place || '追ってご連絡します'}

当日は道着・帯・組手防具をご持参ください。
ご不明な点があればお気軽にご連絡ください。

空手道場`;

    let count = 0;
    for (const member of rows) {
      const result = queueNotification({
        member,
        subject,
        body: renderTemplate(template, mailVars(member)),
      });
      if (result.queued) count += 1;
    }
    redirect(ctx.res, `/mail?msg=${encodeURIComponent(`${count} 件の案内を下書きに追加しました`)}`);
  });
}
