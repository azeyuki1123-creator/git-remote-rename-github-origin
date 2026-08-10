import { all, run } from '../db.js';
import { html, redirect, esc, HttpError } from '../http.js';
import { requireAdmin } from '../auth.js';
import { page, stat, field, textInput, selectBox } from '../views/layout.js';
import { belts, examCandidates, listMembers } from '../domain.js';
import { queueNotification, renderTemplate, mailVars, flushQueue, mailLog, mailStats } from '../mail.js';
import { branches } from '../stamps.js';

const SEGMENTS = [
  ['all', '在籍中の全会員'],
  ['exam', '次回審査の対象者'],
  ['premium', 'プレミアム会員'],
  ['rest', '休会中の会員'],
  ['belt', '帯を指定'],
];

/** 配信対象の生徒を返す */
export function resolveSegment(segment, beltId) {
  switch (segment) {
    case 'exam':
      return examCandidates().map(({ member }) => member);
    case 'premium':
      return listMembers({ status: 'active' }).filter((m) => m.plan === 'premium');
    case 'rest':
      return listMembers({ status: 'rest' });
    case 'belt':
      return listMembers({ status: 'active', beltId });
    case 'all':
    default:
      return listMembers({ status: 'active' });
  }
}

function indexPage(ctx) {
  const stats = mailStats();
  const templates = all('SELECT * FROM mail_templates ORDER BY id');
  const log = mailLog(50);
  const beltList = belts();
  const lineOffBranches = branches().filter((b) => !b.line_enabled);

  const body = `
  <h1>メール・LINE 配信</h1>
  <p class="sub">対象を絞って下書きを作成し、内容を確認してからまとめて送信します。現在の送信方法：<strong>${esc(
    stats.transport === 'smtp' ? 'SMTP 送信' : 'outbox（data/outbox にファイル出力）',
  )}</strong></p>
  <p class="sub">
    宛先は生徒ごとに自動で決まります（LINE 連携済み → LINE、それ以外 → メール）。
    LINE を使わない支部：${esc(lineOffBranches.map((b) => b.name).join('、') || 'なし')}
  </p>

  <div class="grid cols-4">
    ${stat(stats.queued, '未送信（下書き）')}
    ${stat(stats.sent, '送信済み')}
    ${stat(stats.line, 'LINE で送る分')}
    ${stat(stats.failed, '失敗')}
  </div>

  <div class="card">
    <h2 style="margin-top:0">一斉メールを作成</h2>
    <form method="post" action="/mail/compose">
      <div class="row">
        ${field('配信対象', selectBox('segment', SEGMENTS, 'all'))}
        ${field('帯（「帯を指定」の場合）', selectBox('belt_id', beltList.map((b) => [b.id, b.name]), '', { blank: '—' }))}
        ${field(
          'テンプレートを使う',
          selectBox('template_id', templates.map((t) => [t.id, t.name]), '', { blank: '使わない' }),
        )}
      </div>
      <div class="field" style="margin-top:.75rem">
        <label>件名（テンプレート選択時は空欄で可）</label>${textInput('subject', '')}
      </div>
      <div class="field">
        <label>本文（{{name}} {{belt}} {{branch}} {{stamps}} {{stamps_left}} {{discount}} {{next_exam}} {{next_event}} が差し込めます）</label>
        <textarea name="body" placeholder="{{name}} 様&#10;&#10;いつも稽古お疲れさまです。"></textarea>
      </div>
      <button type="submit">下書きを作成</button>
    </form>
  </div>

  <div class="card">
    <h2 style="margin-top:0">送信キュー</h2>
    <form method="post" action="/mail/send" class="inline">
      <button ${stats.queued ? '' : 'disabled'}>未送信の ${stats.queued} 件を送信</button>
    </form>
    <span class="muted" style="font-size:.85rem">SMTP を設定していない場合は data/outbox に .eml が書き出されます。</span>
  </div>

  <div class="card">
    <h2 style="margin-top:0">送信ログ</h2>
    <div class="table-wrap"><table>
      <tr><th>作成日時</th><th>手段</th><th>宛先</th><th>件名</th><th>状態</th><th></th></tr>
      ${
        log.length
          ? log
              .map(
                (m) => `<tr>
        <td class="nowrap">${esc(m.created_at)}</td>
        <td><span class="badge">${m.channel === 'line' ? 'LINE' : 'メール'}</span></td>
        <td>${esc(m.to_name || '')}<br><span class="muted" style="font-size:.8rem">${esc(
          m.channel === 'line' ? m.to_line_id : m.to_email,
        )}</span></td>
        <td>${esc(m.subject)}</td>
        <td>${
          m.status === 'sent'
            ? '<span class="badge ok">送信済み</span>'
            : m.status === 'failed'
              ? `<span class="badge warn" title="${esc(m.error)}">失敗</span>`
              : '<span class="badge">下書き</span>'
        }</td>
        <td class="right">${
          m.status === 'queued'
            ? `<form method="post" action="/mail/${m.id}/delete" class="inline"><button class="ghost small">削除</button></form>`
            : ''
        }</td>
      </tr>`,
              )
              .join('')
          : '<tr><td colspan="6" class="muted">まだ連絡はありません。</td></tr>'
      }
    </table></div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">テンプレート</h2>
    <div class="table-wrap"><table>
      <tr><th>名称</th><th>件名</th><th></th></tr>
      ${
        templates.length
          ? templates
              .map(
                (t) =>
                  `<tr><td>${esc(t.name)}</td><td>${esc(t.subject)}</td>
                   <td class="right"><form method="post" action="/mail/templates/${t.id}/delete" class="inline">
                     <button class="ghost small">削除</button></form></td></tr>`,
              )
              .join('')
          : '<tr><td colspan="3" class="muted">テンプレートは未登録です。</td></tr>'
      }
    </table></div>
    <div class="divider"></div>
    <form method="post" action="/mail/templates">
      <div class="row">
        ${field('名称', textInput('name', '', { required: true }))}
        ${field('件名', textInput('subject', '', { required: true }))}
      </div>
      <div class="field" style="margin-top:.75rem"><label>本文</label><textarea name="body"></textarea></div>
      <button class="ghost">テンプレートを保存</button>
    </form>
  </div>`;

  html(ctx.res, page({ user: ctx.user, title: 'メール配信', active: '/mail', body, flash: ctx.query.get('msg') }));
}

export function register(router) {
  router.get('/mail', (ctx) => {
    requireAdmin(ctx);
    indexPage(ctx);
  });

  router.post('/mail/compose', (ctx) => {
    requireAdmin(ctx);
    let subject = String(ctx.fields.subject || '').trim();
    let body = String(ctx.fields.body || '');

    if (ctx.fields.template_id) {
      const template = all('SELECT * FROM mail_templates WHERE id = ?', [Number(ctx.fields.template_id)])[0];
      if (template) {
        subject = subject || template.subject;
        body = body.trim() ? body : template.body;
      }
    }
    if (!subject) throw new HttpError(400, '件名を入力してください');

    const targets = resolveSegment(ctx.fields.segment, ctx.fields.belt_id);
    let email = 0;
    let line = 0;
    let skipped = 0;
    for (const member of targets) {
      const vars = mailVars(member);
      const result = queueNotification({
        member,
        subject: renderTemplate(subject, vars),
        body: renderTemplate(body, vars),
      });
      if (!result.queued) skipped += 1;
      else if (result.channel === 'line') line += 1;
      else email += 1;
    }
    const parts = [`メール ${email} 件`];
    if (line) parts.push(`LINE ${line} 件`);
    if (skipped) parts.push(`連絡先なし ${skipped} 名は除外`);
    redirect(ctx.res, `/mail?msg=${encodeURIComponent(`下書きを作成しました（${parts.join(' / ')}）`)}`);
  });

  router.post('/mail/send', async (ctx) => {
    requireAdmin(ctx);
    const result = await flushQueue();
    redirect(
      ctx.res,
      `/mail?msg=${encodeURIComponent(`送信 ${result.sent} 件 / 失敗 ${result.failed} 件`)}`,
    );
  });

  router.post('/mail/:id/delete', (ctx) => {
    requireAdmin(ctx);
    run("DELETE FROM mail_messages WHERE id = ? AND status = 'queued'", [Number(ctx.params.id)]);
    redirect(ctx.res, `/mail?msg=${encodeURIComponent('下書きを削除しました')}`);
  });

  router.post('/mail/templates', (ctx) => {
    requireAdmin(ctx);
    run('INSERT INTO mail_templates (name, subject, body) VALUES (?, ?, ?)', [
      String(ctx.fields.name || '').trim(),
      String(ctx.fields.subject || '').trim(),
      String(ctx.fields.body || ''),
    ]);
    redirect(ctx.res, `/mail?msg=${encodeURIComponent('テンプレートを保存しました')}`);
  });

  router.post('/mail/templates/:id/delete', (ctx) => {
    requireAdmin(ctx);
    run('DELETE FROM mail_templates WHERE id = ?', [Number(ctx.params.id)]);
    redirect(ctx.res, `/mail?msg=${encodeURIComponent('テンプレートを削除しました')}`);
  });
}
