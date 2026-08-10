// メール送信。既定は outbox モード（data/outbox に .eml を書き出すだけ）で、
// 環境変数を設定すると SMTP で実送信する。
import net from 'node:net';
import tls from 'node:tls';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { all, get, run, OUTBOX_DIR } from './db.js';

const config = () => ({
  transport: process.env.MAIL_TRANSPORT || 'outbox', // outbox | smtp
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  secure: process.env.SMTP_SECURE === '1', // 465 番など実装時から TLS の場合
  from: process.env.MAIL_FROM || 'dojo@example.com',
  fromName: process.env.MAIL_FROM_NAME || '空手道場',
});

/** {{name}} のような差し込み文字を置換する */
export function renderTemplate(text, vars) {
  return String(text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key) => {
    const value = vars[key];
    return value === undefined || value === null ? whole : String(value);
  });
}

/** 生徒 1 名分の差し込み変数を組み立てる */
export function mailVars(member) {
  const belt = member.belt_id ? get('SELECT * FROM belts WHERE id = ?', [member.belt_id]) : null;
  const nextEvent = get("SELECT * FROM events WHERE starts_on >= date('now') ORDER BY starts_on LIMIT 1");
  const nextExam = get("SELECT * FROM exams WHERE held_on >= date('now') ORDER BY held_on LIMIT 1");
  return {
    name: member.name,
    kana: member.kana,
    belt: belt?.name || '',
    guardian: member.guardian_name || '',
    joined_on: member.joined_on || '',
    next_event: nextEvent ? `${nextEvent.title}（${nextEvent.starts_on}）` : '未定',
    next_exam: nextExam ? `${nextExam.name}（${nextExam.held_on}）` : '未定',
  };
}

/** 送信キューに積む */
export function queueMail({ memberId = null, to, toName = '', subject, body }) {
  const info = run(
    'INSERT INTO mail_messages (member_id, to_email, to_name, subject, body) VALUES (?, ?, ?, ?, ?)',
    [memberId, to, toName, subject, body],
  );
  return Number(info.lastInsertRowid);
}

function encodeWord(text) {
  return `=?UTF-8?B?${Buffer.from(String(text), 'utf8').toString('base64')}?=`;
}

export function buildMime(message) {
  const cfg = config();
  const body = Buffer.from(message.body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const lines = [
    `From: ${encodeWord(cfg.fromName)} <${cfg.from}>`,
    `To: ${message.to_name ? `${encodeWord(message.to_name)} ` : ''}<${message.to_email}>`,
    `Subject: ${encodeWord(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ];
  return lines.join('\r\n');
}

/** キュー内の未送信メールを送信する。{sent, failed} を返す。 */
export async function flushQueue() {
  const pending = all("SELECT * FROM mail_messages WHERE status = 'queued' ORDER BY id");
  let sent = 0;
  let failed = 0;
  for (const message of pending) {
    try {
      await deliver(message);
      run("UPDATE mail_messages SET status = 'sent', sent_at = datetime('now'), error = '' WHERE id = ?", [message.id]);
      sent += 1;
    } catch (err) {
      run("UPDATE mail_messages SET status = 'failed', error = ? WHERE id = ?", [String(err.message || err), message.id]);
      failed += 1;
    }
  }
  return { sent, failed };
}

async function deliver(message) {
  const cfg = config();
  const mime = buildMime(message);
  if (cfg.transport === 'smtp') {
    if (!cfg.host) throw new Error('SMTP_HOST が設定されていません');
    await sendSmtp(cfg, message.to_email, mime);
    return;
  }
  // outbox モード：ファイルに書き出すだけ（開発・動作確認用）
  const file = join(OUTBOX_DIR, `${String(message.id).padStart(6, '0')}-${Date.now()}.eml`);
  await writeFile(file, mime, 'utf8');
}

/**
 * 最小限の SMTP クライアント（AUTH LOGIN / STARTTLS 対応）。
 * 実際のメールサーバーでの動作確認は各自の資格情報で行うこと。
 */
function sendSmtp(cfg, rcpt, mime) {
  return new Promise((resolve, reject) => {
    let socket = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : net.connect({ host: cfg.host, port: cfg.port });

    let buffer = '';
    let queue = [];
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        // 最終行は "250 xxx"（4 文字目が空白）
        if (/^\d{3} /.test(line)) {
          const waiter = queue.shift();
          if (waiter) waiter(line);
        }
      }
    };

    const expect = (codes) =>
      new Promise((res, rej) => {
        queue.push((line) => {
          const code = Number(line.slice(0, 3));
          if (codes.includes(code)) res(line);
          else rej(new Error(`SMTP エラー: ${line}`));
        });
      });

    const send = (line) => socket.write(`${line}\r\n`);

    const attach = () => {
      socket.setEncoding('utf8');
      socket.on('data', onData);
      socket.on('error', fail);
      socket.setTimeout(30000, () => fail(new Error('SMTP タイムアウト')));
    };

    attach();

    (async () => {
      await expect([220]);
      send(`EHLO ${cfg.host}`);
      await expect([250]);

      if (!cfg.secure && cfg.port !== 25) {
        send('STARTTLS');
        await expect([220]);
        const plain = socket;
        plain.removeAllListeners('data');
        socket = tls.connect({ socket: plain, servername: cfg.host });
        buffer = '';
        queue = [];
        await new Promise((res, rej) => {
          socket.once('secureConnect', res);
          socket.once('error', rej);
        });
        attach();
        send(`EHLO ${cfg.host}`);
        await expect([250]);
      }

      if (cfg.user) {
        send('AUTH LOGIN');
        await expect([334]);
        send(Buffer.from(cfg.user, 'utf8').toString('base64'));
        await expect([334]);
        send(Buffer.from(cfg.pass, 'utf8').toString('base64'));
        await expect([235]);
      }

      send(`MAIL FROM:<${cfg.from}>`);
      await expect([250]);
      send(`RCPT TO:<${rcpt}>`);
      await expect([250, 251]);
      send('DATA');
      await expect([354]);
      socket.write(`${mime.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`);
      await expect([250]);
      send('QUIT');
      socket.end();
      if (!settled) {
        settled = true;
        resolve();
      }
    })().catch(fail);
  });
}

export function mailLog(limit = 100) {
  return all('SELECT * FROM mail_messages ORDER BY id DESC LIMIT ?', [limit]);
}

export function mailStats() {
  return {
    queued: get("SELECT COUNT(*) AS c FROM mail_messages WHERE status = 'queued'").c,
    sent: get("SELECT COUNT(*) AS c FROM mail_messages WHERE status = 'sent'").c,
    failed: get("SELECT COUNT(*) AS c FROM mail_messages WHERE status = 'failed'").c,
    transport: config().transport,
  };
}
