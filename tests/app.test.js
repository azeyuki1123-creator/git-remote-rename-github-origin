// 一時ディレクトリに専用の DB を作ってから、アプリ本体を読み込む。
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const dataDir = mkdtempSync(join(tmpdir(), 'dojo-test-'));
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = join(dataDir, 'test.db');

const { get } = await import('../src/db.js');
await import('../scripts/seed.js');
const { createServer } = await import('../src/server.js');
const { parseMultipart } = await import('../src/http.js');
const { renderTemplate } = await import('../src/mail.js');
const { examReadiness, canViewContent, monthsSince } = await import('../src/domain.js');

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
