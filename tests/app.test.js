// 一時ディレクトリに専用の DB を作ってから、アプリ本体を読み込む。
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const dataDir = mkdtempSync(join(tmpdir(), 'dojo-test-'));
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = join(dataDir, 'test.db');

const { get, all, run } = await import('../src/db.js');
await import('../scripts/seed.js');
const { createServer } = await import('../src/server.js');
const { parseMultipart } = await import('../src/http.js');
const { renderTemplate } = await import('../src/mail.js');
const { examReadiness, canViewContent, monthsSince } = await import('../src/domain.js');
const { stampSummary, grantStamp, voidStamp, branchById } = await import('../src/stamps.js');
const { resolveChannel, verifySignature, issueLinkCode, linkByCode } = await import('../src/line.js');

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

/** ログインして Cookie 文字列を返す */
async function loginAs(email, password = 'dojo1234') {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }),
    redirect: 'manual',
  });
  assert.equal(res.status, 303, `${email} でログインできること`);
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  return cookie;
}

const req = (path, cookie, init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { cookie, ...(init.headers || {}) }, redirect: 'manual' });

const post = (path, cookie, data) =>
  req(path, cookie, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data),
  });

describe('認証とアクセス制御', () => {
  test('未ログインでは保護ページからログイン画面へ飛ばされる', async () => {
    const res = await fetch(`${base}/members`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/login');
  });

  test('パスワードが違うと 401', async () => {
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'sensei@dojo.test', password: 'wrong' }),
      redirect: 'manual',
    });
    assert.equal(res.status, 401);
  });

  test('会員は指導者専用ページにアクセスできない', async () => {
    const cookie = await loginAs('takumi@example.com');
    for (const path of ['/members', '/attendance', '/exams', '/mail']) {
      assert.equal((await req(path, cookie)).status, 403, `${path} は 403 になること`);
    }
  });

  test('指導者は全ページを開ける', async () => {
    const cookie = await loginAs('sensei@dojo.test');
    for (const path of ['/', '/members', '/attendance', '/exams', '/contents', '/videos', '/events', '/mail']) {
      assert.equal((await req(path, cookie)).status, 200, `${path} は 200 になること`);
    }
  });
});

describe('帯によるコンテンツの出し分け', () => {
  test('上位帯限定コンテンツは下位帯の会員には 403', async () => {
    const cookie = await loginAs('riko@example.com'); // 白帯
    const locked = get("SELECT c.id FROM contents c JOIN belts b ON b.id = c.min_belt_id WHERE b.rank_order >= 5 LIMIT 1");
    assert.ok(locked, '上位帯限定のコンテンツが存在すること');
    assert.equal((await req(`/contents/${locked.id}`, cookie)).status, 403);
  });

  test('全会員公開のコンテンツは誰でも読める', async () => {
    const cookie = await loginAs('riko@example.com');
    const open = get('SELECT id FROM contents WHERE min_belt_id IS NULL AND is_premium = 0 LIMIT 1');
    assert.equal((await req(`/contents/${open.id}`, cookie)).status, 200);
  });

  test('プレミアム限定は通常プランの会員には見えない', () => {
    const standard = get("SELECT * FROM members WHERE plan = 'standard' ORDER BY id LIMIT 1");
    const premiumContent = { published: 1, is_premium: 1, min_belt_id: null };
    const user = { role: 'member', member: standard };
    assert.equal(canViewContent(user, premiumContent).ok, false);

    const premiumMember = get("SELECT * FROM members WHERE plan = 'premium' ORDER BY id LIMIT 1");
    assert.equal(canViewContent({ role: 'member', member: premiumMember }, premiumContent).ok, true);
  });
});

describe('出欠と審査', () => {
  test('出欠を保存すると審査判定の出席回数に反映される', async () => {
    const cookie = await loginAs('sensei@dojo.test');
    const member = get('SELECT * FROM members ORDER BY id LIMIT 1');
    const session = get('SELECT * FROM training_sessions ORDER BY held_on DESC LIMIT 1');

    const before = examReadiness(get('SELECT * FROM members WHERE id = ?', [member.id])).attendance;
    await post(`/attendance/${session.id}`, cookie, { [`s_${member.id}`]: 'absent' });
    const afterAbsent = examReadiness(get('SELECT * FROM members WHERE id = ?', [member.id])).attendance;
    await post(`/attendance/${session.id}`, cookie, { [`s_${member.id}`]: 'present' });
    const afterPresent = examReadiness(get('SELECT * FROM members WHERE id = ?', [member.id])).attendance;

    assert.equal(afterPresent, afterAbsent + 1);
    assert.ok(before >= 0);
  });

  test('合格にすると帯が繰り上がり昇級日が記録される', async () => {
    const cookie = await loginAs('sensei@dojo.test');
    const exam = get('SELECT * FROM exams ORDER BY id LIMIT 1');
    const member = get("SELECT * FROM members WHERE status = 'active' ORDER BY id LIMIT 1");
    const nextBeltId = get('SELECT id FROM belts WHERE rank_order > (SELECT rank_order FROM belts WHERE id = ?) ORDER BY rank_order LIMIT 1', [member.belt_id]).id;

    await post(`/exams/${exam.id}/add`, cookie, { member_ids: String(member.id), [`target_${member.id}`]: String(nextBeltId) });
    await post(`/exams/${exam.id}/decision`, cookie, { member_id: String(member.id), decision: 'passed' });

    const updated = get('SELECT * FROM members WHERE id = ?', [member.id]);
    assert.equal(updated.belt_id, nextBeltId);
    assert.equal(updated.last_promoted_on, new Date().toISOString().slice(0, 10));
  });

  test('手動指定した生徒は条件未達でも審査対象になる', () => {
    const member = get("SELECT * FROM members WHERE status = 'active' ORDER BY id DESC LIMIT 1");
    const flagged = { ...member, exam_flag: 1 };
    assert.equal(examReadiness(flagged).ready, true);
  });
});

describe('メール配信', () => {
  test('差し込み文字が置換され、送信すると outbox に書き出される', async () => {
    const cookie = await loginAs('sensei@dojo.test');
    await post('/mail/compose', cookie, {
      segment: 'all',
      subject: 'テスト配信',
      body: '{{name}} 様、現在の帯は {{belt}} です。',
    });
    const queued = get("SELECT * FROM mail_messages WHERE subject = 'テスト配信' ORDER BY id LIMIT 1");
    assert.ok(queued, '下書きが作成されること');
    assert.ok(!queued.body.includes('{{name}}'), '差し込み文字が残っていないこと');
    assert.ok(queued.body.startsWith(queued.to_name), '氏名が差し込まれていること');

    await post('/mail/send', cookie, {});
    const sent = get('SELECT * FROM mail_messages WHERE id = ?', [queued.id]);
    assert.equal(sent.status, 'sent');
    assert.ok(readdirSync(join(dataDir, 'outbox')).length > 0, '.eml が書き出されること');
  });

  test('未定義の差し込み文字はそのまま残す', () => {
    assert.equal(renderTemplate('{{name}} と {{unknown}}', { name: '田中' }), '田中 と {{unknown}}');
  });
});

describe('動画の提出とファイル配信', () => {
  test('会員は動画 URL を提出でき、他人の動画は見られない', async () => {
    const owner = await loginAs('takumi@example.com');
    const res = await post('/videos', owner, {
      title: 'テスト提出',
      note: '確認用',
      url: 'https://youtu.be/abcdefg',
    });
    assert.equal(res.status, 303);
    const id = Number(/\/videos\/(\d+)/.exec(res.headers.get('location'))[1]);

    assert.equal((await req(`/videos/${id}`, owner)).status, 200);
    const other = await loginAs('misaki@example.com');
    assert.equal((await req(`/videos/${id}`, other)).status, 403);

    // 指導者がアドバイスを返すと添削済みになる
    const sensei = await loginAs('sensei@dojo.test');
    await post(`/videos/${id}/feedback`, sensei, { comment: '引き手を意識しましょう', score: '80' });
    assert.equal(get('SELECT status FROM video_submissions WHERE id = ?', [id]).status, 'reviewed');
  });

  test('ファイルも URL も無い提出は 400', async () => {
    const owner = await loginAs('takumi@example.com');
    assert.equal((await post('/videos', owner, { title: '空の提出' })).status, 400);
  });
});

describe('スタンプカード', () => {
  /** テスト用に、スタンプを 1 個も持たない生徒を作る */
  function freshMember(branchId) {
    const belt = get('SELECT id FROM belts ORDER BY rank_order LIMIT 1');
    const info = run(
      `INSERT INTO members (name, kana, belt_id, joined_on, last_promoted_on, branch_id, email, status)
       VALUES ('検証 太郎', 'けんしょう たろう', ?, '2020-01-01', '2020-01-01', ?, 'kensho@example.com', 'active')`,
      [belt.id, branchId],
    );
    return get('SELECT * FROM members WHERE id = ?', [Number(info.lastInsertRowid)]);
  }

  test('生徒は自分でスタンプを押せない（指導者専用の操作）', async () => {
    const cookie = await loginAs('takumi@example.com');
    assert.equal((await req('/stamps', cookie)).status, 403);
    assert.equal((await post('/stamps/grant', cookie, { member_ids: '1' })).status, 403);
    assert.equal((await post('/stamps/1/void', cookie, {})).status, 403);
    assert.equal((await req('/branches', cookie)).status, 403);
  });

  test('マイページに押印ボタンが出ない', async () => {
    const cookie = await loginAs('takumi@example.com');
    const body = await (await req('/', cookie)).text();
    assert.ok(!body.includes('/stamps/grant'), '押印フォームが含まれていないこと');
    assert.ok(body.includes('指導者が押します'), '押せないことが明記されていること');
  });

  test('規定数たまると審査を受けられ、それ以上は台紙が進まない', () => {
    const branch = get('SELECT * FROM branches ORDER BY is_main DESC LIMIT 1');
    const member = freshMember(branch.id);
    const admin = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");

    assert.equal(stampSummary(member).examEligible, false);
    for (let i = 0; i < branch.stamps_per_card - 1; i += 1) {
      grantStamp({ memberId: member.id, reason: '稽古出席', grantedBy: admin.id, grantedOn: '2024-01-01' });
    }
    let summary = stampSummary(get('SELECT * FROM members WHERE id = ?', [member.id]));
    assert.equal(summary.remaining, 1, 'あと 1 個');
    assert.equal(summary.examEligible, false);

    grantStamp({ memberId: member.id, reason: '稽古出席', grantedBy: admin.id, grantedOn: '2024-01-01' });
    summary = stampSummary(get('SELECT * FROM members WHERE id = ?', [member.id]));
    assert.equal(summary.examEligible, true, '規定数で受験資格');
    assert.equal(examReadiness(get('SELECT * FROM members WHERE id = ?', [member.id])).ready, true);

    // 超過分で台紙表示が 0 に巻き戻らないこと
    grantStamp({ memberId: member.id, reason: '大会参加', grantedBy: admin.id, grantedOn: '2024-01-02' });
    summary = stampSummary(get('SELECT * FROM members WHERE id = ?', [member.id]));
    assert.equal(summary.progress, branch.stamps_per_card);
  });

  test('割引は既定でオフ（審査料は現金徴収の運用）', async () => {
    for (const branch of all('SELECT * FROM branches')) {
      assert.equal(branch.discount_enabled, 0, `${branch.name}は割引オフで始まること`);
    }
    const branch = get('SELECT * FROM branches ORDER BY is_main DESC LIMIT 1');
    const member = freshMember(branch.id);
    const admin = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    for (let i = 0; i < branch.stamps_per_card * 3; i += 1) {
      grantStamp({ memberId: member.id, grantedBy: admin.id, grantedOn: '2024-01-01' });
    }
    const summary = stampSummary(member);
    assert.equal(summary.completedCards, 3, '台紙の枚数自体は数えていること');
    assert.equal(summary.discountAmount, 0, '割引は発生しないこと');

    // 生徒にも指導者にも割引の表示が出ない
    const cookie = await loginAs('sensei@dojo.test');
    const stampsPage = await (await req('/stamps', cookie)).text();
    assert.ok(!stampsPage.includes('割引の状況'), '割引の一覧が出ないこと');
  });

  test('割引をオンにすると 2 枚目以降で段階的に増える', () => {
    const branch = get('SELECT * FROM branches ORDER BY is_main DESC LIMIT 1');
    run('UPDATE branches SET discount_enabled = 1 WHERE id = ?', [branch.id]);
    const member = freshMember(branch.id);
    const admin = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    const per = branch.stamps_per_card;

    const stampMany = (n) => {
      for (let i = 0; i < n; i += 1) {
        grantStamp({ memberId: member.id, reason: '稽古出席', grantedBy: admin.id, grantedOn: '2024-01-01' });
      }
      return stampSummary(get('SELECT * FROM members WHERE id = ?', [member.id]));
    };

    let summary = stampMany(per); // 1 枚目 = 審査資格のみ、割引なし
    assert.equal(summary.completedCards, 1);
    assert.equal(summary.discountCards, 0);
    assert.equal(summary.discountAmount, 0);

    summary = stampMany(per); // 2 枚目 = 割引 1 段階
    assert.equal(summary.discountCards, 1);
    assert.equal(summary.discountAmount, branch.discount_per_card);

    summary = stampMany(per); // 3 枚目 = 割引 2 段階
    assert.equal(summary.discountCards, 2);
    assert.equal(summary.discountAmount, branch.discount_per_card * 2);

    run('UPDATE branches SET discount_enabled = 0 WHERE id = ?', [branch.id]);
    assert.equal(stampSummary(get('SELECT * FROM members WHERE id = ?', [member.id])).discountAmount, 0);
  });

  test('取り消したスタンプは数に入らず、誰が取り消したか残る', () => {
    const branch = get('SELECT * FROM branches ORDER BY is_main DESC LIMIT 1');
    const member = freshMember(branch.id);
    const admin = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");

    const { id } = grantStamp({ memberId: member.id, reason: '稽古出席', grantedBy: admin.id });
    assert.equal(stampSummary(member).earned, 1);

    voidStamp(id, admin.id, '誤って押した');
    assert.equal(stampSummary(member).earned, 0);
    const row = get('SELECT * FROM stamps WHERE id = ?', [id]);
    assert.equal(row.status, 'void');
    assert.equal(row.voided_by, admin.id);
    assert.equal(row.void_reason, '誤って押した');
  });

  test('同じ稽古で二重に押されない', () => {
    const branch = get('SELECT * FROM branches ORDER BY is_main DESC LIMIT 1');
    const member = freshMember(branch.id);
    const admin = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    const session = get('SELECT * FROM training_sessions ORDER BY id LIMIT 1');

    const first = grantStamp({ memberId: member.id, sessionId: session.id, grantedBy: admin.id });
    const second = grantStamp({ memberId: member.id, sessionId: session.id, grantedBy: admin.id });
    assert.equal(first.created, true);
    assert.equal(second.created, false, '2 回目は増えないこと');
    assert.equal(stampSummary(member).earned, 1);
  });

  test('押印者を指定しないと押せない', () => {
    const branch = get('SELECT * FROM branches ORDER BY is_main DESC LIMIT 1');
    const member = freshMember(branch.id);
    assert.throws(() => grantStamp({ memberId: member.id, grantedBy: null }), /押印者/);
  });

  test('出欠を保存すると出席者にスタンプが押され、欠席に直すと取り消される', async () => {
    const cookie = await loginAs('sensei@dojo.test');
    const session = get('SELECT * FROM training_sessions ORDER BY held_on DESC LIMIT 1');
    const member = get('SELECT * FROM members WHERE branch_id = ? ORDER BY id LIMIT 1', [session.branch_id]);

    await post(`/attendance/${session.id}`, cookie, { [`s_${member.id}`]: 'present', auto_stamp: '1' });
    let stamp = get('SELECT * FROM stamps WHERE member_id = ? AND session_id = ?', [member.id, session.id]);
    assert.equal(stamp.status, 'active');
    assert.ok(stamp.granted_by, '押した指導者が記録されること');

    await post(`/attendance/${session.id}`, cookie, { [`s_${member.id}`]: 'absent', auto_stamp: '1' });
    stamp = get('SELECT * FROM stamps WHERE member_id = ? AND session_id = ?', [member.id, session.id]);
    assert.equal(stamp.status, 'void');
  });

  test('支部ごとにスタンプ必要数を変えられる', async () => {
    const cookie = await loginAs('sensei@dojo.test');
    const branch = get('SELECT * FROM branches ORDER BY is_main DESC LIMIT 1');
    await post(`/branches/${branch.id}`, cookie, {
      name: branch.name,
      stamps_per_card: '10',
      discount_per_card: '800',
      discount_max_cards: '6',
      exam_rule: 'stamp',
      reset_on_promotion: '1',
      line_enabled: String(branch.line_enabled),
    });
    assert.equal(branchById(branch.id).stamps_per_card, 10);

    const member = freshMember(branch.id);
    const admin = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    for (let i = 0; i < 10; i += 1) {
      grantStamp({ memberId: member.id, grantedBy: admin.id, grantedOn: '2024-01-01' });
    }
    assert.equal(stampSummary(member).examEligible, true, '10 個で受験資格になること');

    // 後続のテストに影響しないよう元に戻す
    await post(`/branches/${branch.id}`, cookie, {
      name: branch.name,
      stamps_per_card: String(branch.stamps_per_card),
      discount_per_card: String(branch.discount_per_card),
      discount_max_cards: String(branch.discount_max_cards),
      exam_rule: branch.exam_rule,
      reset_on_promotion: String(branch.reset_on_promotion),
      line_enabled: String(branch.line_enabled),
    });
  });
});

describe('LINE 連携', () => {
  const nanseiBranch = () => get("SELECT * FROM branches WHERE name = '名西支部'");

  test('LINE を使わない支部の生徒はメールに振り分けられる', () => {
    const branch = nanseiBranch();
    assert.equal(branch.line_enabled, 0, '名西支部は LINE 連携なしの設定');
    const member = get('SELECT * FROM members WHERE branch_id = ? AND email <> \'\' LIMIT 1', [branch.id]);
    // 連携済みに見える状態でも、支部が無効ならメールになる
    run("UPDATE members SET line_user_id = 'U-dummy', notify_channel = 'line' WHERE id = ?", [member.id]);
    const target = resolveChannel(get('SELECT * FROM members WHERE id = ?', [member.id]));
    assert.equal(target.channel, 'email');
    run("UPDATE members SET line_user_id = '', notify_channel = 'auto' WHERE id = ?", [member.id]);
  });

  test('連携コードを送ると生徒に LINE ID が紐づき、有効な支部では LINE が選ばれる', () => {
    const branch = get("SELECT * FROM branches WHERE is_main = 1");
    run("UPDATE branches SET line_enabled = 1, line_token = 'T', line_secret = 'S' WHERE id = ?", [branch.id]);
    const member = get('SELECT * FROM members WHERE branch_id = ? LIMIT 1', [branch.id]);

    const code = issueLinkCode(member.id);
    assert.match(code, /^\d{6}$/);
    const linked = linkByCode(code, 'U-abc');
    assert.equal(linked.id, member.id);

    const updated = get('SELECT * FROM members WHERE id = ?', [member.id]);
    assert.equal(updated.line_user_id, 'U-abc');
    assert.equal(updated.line_link_code, '', 'コードは使い捨て');
    assert.equal(resolveChannel(updated).channel, 'line');

    // 存在しないコードでは紐づかない
    assert.equal(linkByCode('000000', 'U-other'), null);
  });

  test('Webhook は署名が一致しないと受け付けない', async () => {
    const branch = get("SELECT * FROM branches WHERE is_main = 1");
    run("UPDATE branches SET line_enabled = 1, line_token = 'T', line_secret = 'S' WHERE id = ?", [branch.id]);
    const body = JSON.stringify({ events: [] });
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', 'S').update(body).digest('base64');

    assert.equal(verifySignature('S', body, signature), true);
    assert.equal(verifySignature('S', body, 'wrong'), false);
    assert.equal(verifySignature('', body, signature), false);

    const bad = await fetch(`${base}/line/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'wrong' },
      body,
    });
    assert.equal(bad.status, 401);

    const good = await fetch(`${base}/line/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signature },
      body,
    });
    assert.equal(good.status, 200);
  });

  test('支部設定を切り替えるだけで、その支部の連絡が LINE 優先に変わる', async () => {
    const cookie = await loginAs('sensei@dojo.test');
    const branch = nanseiBranch();
    const member = get('SELECT * FROM members WHERE branch_id = ? LIMIT 1', [branch.id]);

    // 提携先の準備前：LINE ID を持っていてもメール
    run("UPDATE members SET line_user_id = 'U-nansei' WHERE id = ?", [member.id]);
    assert.equal(resolveChannel(get('SELECT * FROM members WHERE id = ?', [member.id])).channel, 'email');

    // 連携できるようになったら、支部設定を「使う」にするだけで切り替わる
    await post(`/branches/${branch.id}`, cookie, {
      name: branch.name,
      stamps_per_card: String(branch.stamps_per_card),
      exam_rule: branch.exam_rule,
      reset_on_promotion: String(branch.reset_on_promotion),
      line_enabled: '1',
      line_token: 'NANSEI-TOKEN',
      line_secret: 'NANSEI-SECRET',
      discount_enabled: '0',
      discount_per_card: String(branch.discount_per_card),
      discount_max_cards: String(branch.discount_max_cards),
    });
    assert.equal(branchById(branch.id).line_enabled, 1);
    assert.equal(resolveChannel(get('SELECT * FROM members WHERE id = ?', [member.id])).channel, 'line');

    // 同じ支部でも未連携の生徒はメールのまま
    const notLinked = get("SELECT * FROM members WHERE branch_id = ? AND line_user_id = '' AND email <> '' LIMIT 1", [
      branch.id,
    ]);
    assert.equal(resolveChannel(notLinked).channel, 'email');

    // 元に戻す
    await post(`/branches/${branch.id}`, cookie, {
      name: branch.name,
      stamps_per_card: String(branch.stamps_per_card),
      exam_rule: branch.exam_rule,
      reset_on_promotion: String(branch.reset_on_promotion),
      line_enabled: '0',
      discount_enabled: '0',
      discount_per_card: String(branch.discount_per_card),
      discount_max_cards: String(branch.discount_max_cards),
    });
    run("UPDATE members SET line_user_id = '' WHERE id = ?", [member.id]);
    assert.equal(resolveChannel(get('SELECT * FROM members WHERE id = ?', [member.id])).channel, 'email');
  });

  test('配信は生徒ごとに LINE とメールへ振り分けられる', async () => {
    const cookie = await loginAs('sensei@dojo.test');
    await post('/mail/compose', cookie, { segment: 'all', subject: '振り分け確認', body: '{{name}} 様' });
    const rows = all("SELECT channel, COUNT(*) AS c FROM mail_messages WHERE subject = '振り分け確認' GROUP BY channel");
    const channels = Object.fromEntries(rows.map((r) => [r.channel, r.c]));
    assert.ok(channels.line >= 1, 'LINE 連携済みの生徒には LINE で積まれること');
    assert.ok(channels.email >= 1, '未連携の生徒にはメールで積まれること');
  });
});

describe('ユーティリティ', () => {
  test('multipart/form-data を解析できる', () => {
    const boundary = 'X-BOUNDARY';
    const raw = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n平安初段\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="a.mp4"\r\n` +
        `Content-Type: video/mp4\r\n\r\nBINARY\r\n--${boundary}--\r\n`,
      'utf8',
    );
    const { fields, files } = parseMultipart(raw, boundary);
    assert.equal(fields.title, '平安初段');
    assert.equal(files.video.originalName, 'a.mp4');
    assert.equal(files.video.data.toString('utf8'), 'BINARY');
  });

  test('経過月数を数えられる', () => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - 5);
    assert.equal(monthsSince(d.toISOString().slice(0, 10)), 5);
    assert.equal(monthsSince(''), 0);
  });
});
