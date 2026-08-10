import { all, get } from '../db.js';
import { html, redirect, esc } from '../http.js';
import { requireUser } from '../auth.js';
import { page, stat, bar, beltTag, stampCard, yen } from '../views/layout.js';
import { examCandidates, examReadiness, contentsFor, belts } from '../domain.js';
import { mailStats } from '../mail.js';

function adminDashboard(ctx) {
  const activeCount = get("SELECT COUNT(*) AS c FROM members WHERE status = 'active'").c;
  const monthSessions = get(
    "SELECT COUNT(*) AS c FROM training_sessions WHERE held_on >= date('now','start of month')",
  ).c;
  const pendingVideos = get("SELECT COUNT(*) AS c FROM video_submissions WHERE status = 'pending'").c;
  const mails = mailStats();
  const candidates = examCandidates();

  const beltRows = all(
    `SELECT b.name, b.color, COUNT(m.id) AS c
     FROM belts b LEFT JOIN members m ON m.belt_id = b.id AND m.status = 'active'
     GROUP BY b.id ORDER BY b.rank_order DESC`,
  );

  const recentSessions = all(
    `SELECT t.*,
            (SELECT COUNT(*) FROM attendance a WHERE a.session_id = t.id AND a.status IN ('present','late')) AS present
     FROM training_sessions t ORDER BY t.held_on DESC, t.id DESC LIMIT 6`,
  );

  const upcoming = all("SELECT * FROM events WHERE starts_on >= date('now') ORDER BY starts_on LIMIT 5");

  const body = `
  <h1>ダッシュボード</h1>
  <p class="sub">道場全体の状況をひと目で確認できます。</p>

  <div class="grid cols-4">
    ${stat(activeCount, '在籍中の生徒')}
    ${stat(monthSessions, '今月の稽古回数')}
    ${stat(candidates.length, '審査対象者')}
    ${stat(pendingVideos, '未添削の動画')}
  </div>

  <div class="grid cols-2">
    <div class="card">
      <h2 style="margin-top:0">審査対象者</h2>
      ${
        candidates.length === 0
          ? '<p class="muted">現在、条件を満たしている生徒はいません。</p>'
          : `<div class="table-wrap"><table>
              <tr><th>生徒</th><th>現在の帯</th><th>次の帯</th><th>達成度</th><th></th></tr>
              ${candidates
                .map(
                  ({ member, readiness }) => `<tr>
                  <td><a href="/members/${member.id}">${esc(member.name)}</a>${
                    readiness.manual ? ' <span class="badge warn">手動指定</span>' : ''
                  }</td>
                  <td>${beltTag(readiness.belt?.name, readiness.belt?.color)}</td>
                  <td>${beltTag(readiness.nextBelt?.name ?? '—', readiness.nextBelt?.color)}</td>
                  <td style="min-width:110px">${bar(readiness.progress)}</td>
                  <td class="right"><a class="btn small ghost" href="/members/${member.id}">詳細</a></td>
                </tr>`,
                )
                .join('')}
            </table></div>`
      }
      <div style="margin-top:.8rem"><a class="btn ghost small" href="/exams">審査会の管理へ</a></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">帯別の在籍状況</h2>
      <div class="table-wrap"><table>
        ${beltRows
          .map(
            (b) =>
              `<tr><td>${beltTag(b.name, b.color)}</td><td style="width:60%">${bar(
                activeCount ? b.c / activeCount : 0,
              )}</td><td class="right nowrap">${b.c} 名</td></tr>`,
          )
          .join('')}
      </table></div>
    </div>
  </div>

  <div class="grid cols-2">
    <div class="card">
      <h2 style="margin-top:0">直近の稽古</h2>
      <div class="table-wrap"><table>
        <tr><th>日付</th><th>内容</th><th class="right">出席</th></tr>
        ${
          recentSessions.length
            ? recentSessions
                .map(
                  (s) =>
                    `<tr><td class="nowrap">${esc(s.held_on)}</td><td><a href="/attendance/${s.id}">${esc(
                      s.title,
                    )}</a></td><td class="right">${s.present} 名</td></tr>`,
                )
                .join('')
            : '<tr><td colspan="3" class="muted">まだ稽古が登録されていません。</td></tr>'
        }
      </table></div>
      <div style="margin-top:.8rem"><a class="btn ghost small" href="/attendance">出欠の登録へ</a></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">これからの予定</h2>
      <ul class="list-reset">
        ${
          upcoming.length
            ? upcoming
                .map(
                  (e) =>
                    `<li style="padding:.35rem 0;border-bottom:1px solid var(--line)"><span class="badge">${esc(
                      e.kind,
                    )}</span> <a href="/events">${esc(e.title)}</a><br><span class="muted">${esc(
                      e.starts_on,
                    )} ${esc(e.place)}</span></li>`,
                )
                .join('')
            : '<li class="muted">予定はありません。</li>'
        }
      </ul>
      <div style="margin-top:.8rem">
        <a class="btn ghost small" href="/events">イベント管理</a>
        <a class="btn ghost small" href="/mail">メール配信（未送信 ${mails.queued} 件）</a>
      </div>
    </div>
  </div>`;

  html(ctx.res, page({ user: ctx.user, title: 'ダッシュボード', active: '/', body, flash: ctx.query.get('msg') }));
}

function memberDashboard(ctx) {
  const member = ctx.user.member;
  if (!member) {
    return html(
      ctx.res,
      page({
        user: ctx.user,
        title: 'マイページ',
        active: '/',
        body: '<div class="card"><p>このアカウントには生徒名簿が紐づいていません。指導者にお問い合わせください。</p></div>',
      }),
    );
  }

  const readiness = examReadiness(member);
  const contents = contentsFor(ctx.user);
  const unlocked = contents.filter((c) => c.access.ok).length;
  const allBelts = belts();
  const myOrder = readiness.belt?.rank_order ?? 0;

  const recentFeedback = all(
    `SELECT f.*, v.title FROM video_feedback f
     JOIN video_submissions v ON v.id = f.submission_id
     WHERE v.member_id = ? ORDER BY f.id DESC LIMIT 3`,
    [member.id],
  );

  const upcoming = all("SELECT * FROM events WHERE starts_on >= date('now') ORDER BY starts_on LIMIT 3");

  const stamps = readiness.stamps;
  const body = `
  <h1>${esc(member.name)} さんのマイページ</h1>
  <p class="sub">現在の帯 ${esc(readiness.belt?.name ?? '')} ／ ${esc(stamps.branch?.name ?? '')} ／ 入会日 ${esc(
    member.joined_on,
  )}</p>

  <div class="grid cols-4">
    ${stat(`${stamps.progress} / ${stamps.perCard}`, 'スタンプ（現在の台紙）')}
    ${stat(stamps.earned, '累計スタンプ')}
    ${stat(`${unlocked} / ${contents.length}`, '解放したコンテンツ')}
    ${
      stamps.discountEnabled
        ? stat(stamps.discountCards ? yen(stamps.discountAmount) : 'なし', '月謝の割引')
        : stat(readiness.ready ? '対象' : '準備中', '次回審査')
    }
  </div>

  <div class="card">
    <h2 style="margin-top:0">スタンプカード</h2>
    ${stampCard(stamps)}
    <p style="margin:.4rem 0 0">
      ${
        stamps.examEligible
          ? '<span class="badge ok">スタンプがたまりました</span> 審査を受けられます。'
          : `審査を受けられるまであと <strong>${stamps.remaining}</strong> 個です。`
      }
      ${
        !stamps.discountEnabled
          ? ''
          : stamps.discountCards
            ? `<br>台紙 ${stamps.completedCards} 枚達成 → 月謝が <strong>${yen(
                stamps.discountAmount,
              )}</strong> 割引になっています。`
            : `<br>台紙が 2 枚目以降そろうと、1 枚ごとに月謝が ${yen(
                stamps.branch?.discount_per_card ?? 0,
              )} 割引になります。`
      }
    </p>
    <p class="muted" style="font-size:.85rem;margin-bottom:0">
      スタンプは稽古のときに指導者が押します。アプリから自分で押すことはできません。
    </p>
  </div>

  ${
    // スタンプだけが条件の支部では上のカードと同じ内容になるので出さない
    readiness.checks.length > 1
      ? `<div class="card">
    <h2 style="margin-top:0">${esc(readiness.nextBelt?.name ?? '次の帯')}への道</h2>
    ${bar(readiness.progress)}
    <div class="table-wrap" style="margin-top:.8rem"><table>
      ${readiness.checks
        .map(
          (c) =>
            `<tr><td class="nowrap">${esc(c.label)}</td><td>${esc(c.detail)}</td><td class="right">${
              c.ok ? '<span class="badge ok">クリア</span>' : '<span class="badge warn">あと少し</span>'
            }</td></tr>`,
        )
        .join('')}
    </table></div>
    ${
      readiness.ready
        ? '<p style="margin-bottom:0"><span class="badge ok">次回審査の対象者です</span> 指導者からの案内をお待ちください。</p>'
        : ''
    }
  </div>`
      : readiness.ready
        ? `<div class="card"><span class="badge ok">次回審査の対象者です</span>
             ${esc(readiness.nextBelt?.name ?? '次の帯')}の審査に向けて、指導者からの案内をお待ちください。</div>`
        : ''
  }

  <div class="grid cols-2">
    <div class="card">
      <h2 style="margin-top:0">帯で解放されるコンテンツ</h2>
      <div class="table-wrap"><table>
        <tr><th>帯</th><th>本数</th><th class="right">状態</th></tr>
        ${allBelts
          .map((b) => {
            const count = contents.filter((c) => c.min_belt_id === b.id).length;
            if (count === 0) return '';
            const open = b.rank_order <= myOrder;
            return `<tr class="${open ? '' : 'locked'}"><td>${beltTag(b.name, b.color)}</td><td>${count} 本</td>
              <td class="right">${
                open ? '<span class="badge ok">解放済み</span>' : '<span class="badge lock">🔒 未解放</span>'
              }</td></tr>`;
          })
          .join('')}
      </table></div>
      <div style="margin-top:.8rem"><a class="btn ghost small" href="/contents">学びの部屋へ</a></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">最近のアドバイス</h2>
      ${
        recentFeedback.length
          ? `<ul class="list-reset">${recentFeedback
              .map(
                (f) =>
                  `<li style="padding:.4rem 0;border-bottom:1px solid var(--line)"><strong>${esc(
                    f.title,
                  )}</strong><br>${esc(f.comment)}<br><span class="muted">${esc(f.created_at)}</span></li>`,
              )
              .join('')}</ul>`
          : '<p class="muted">まだアドバイスはありません。稽古動画を送ってみましょう。</p>'
      }
      <div style="margin-top:.8rem"><a class="btn ghost small" href="/videos">動画を提出する</a></div>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">これからの試合・イベント</h2>
    ${
      upcoming.length
        ? `<ul class="list-reset">${upcoming
            .map(
              (e) =>
                `<li style="padding:.35rem 0"><span class="badge">${esc(e.kind)}</span> <a href="/events">${esc(
                  e.title,
                )}</a> <span class="muted">${esc(e.starts_on)}</span></li>`,
            )
            .join('')}</ul>`
        : '<p class="muted">予定はありません。</p>'
    }
  </div>`;

  html(ctx.res, page({ user: ctx.user, title: 'マイページ', active: '/', body, flash: ctx.query.get('msg') }));
}

export function register(router) {
  router.get('/', (ctx) => {
    if (!ctx.user) return redirect(ctx.res, '/login');
    requireUser(ctx);
    return ctx.user.role === 'admin' ? adminDashboard(ctx) : memberDashboard(ctx);
  });
}
