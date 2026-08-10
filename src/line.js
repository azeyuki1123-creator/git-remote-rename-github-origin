// LINE 公式アカウント（Messaging API）連携。
//
// 支部ごとに有効・無効を切り替えられる（例：名西支部は連携なし → 連絡はメールのみ）。
// LINE が使えない支部・未連携の生徒は自動的にメールへフォールバックする。
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { get, run } from './db.js';
import { branchOf } from './stamps.js';

const PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

/** その生徒に LINE を送れるか */
export function lineAvailable(member) {
  const branch = branchOf(member);
  return Boolean(branch?.line_enabled && branch.line_token && member.line_user_id);
}

/**
 * 実際に使う連絡手段を決める。
 * notify_channel が 'line' でも、支部が無効／未連携ならメールに落とす。
 */
export function resolveChannel(member) {
  const preference = member.notify_channel || 'auto';
  if (preference !== 'email' && lineAvailable(member)) {
    return { channel: 'line', to: member.line_user_id };
  }
  if (member.email) return { channel: 'email', to: member.email };
  return { channel: 'none', to: '', reason: lineFallbackReason(member) };
}

function lineFallbackReason(member) {
  const branch = branchOf(member);
  if (!branch?.line_enabled) return `${branch?.name ?? '支部'}は LINE 連携を使わない設定です`;
  if (!branch.line_token) return `${branch.name}のチャネルアクセストークンが未設定です`;
  if (!member.line_user_id) return 'LINE が未連携です';
  return 'メールアドレスが未登録です';
}

/** 生徒に連携コードを発行する（生徒が公式アカウントにこのコードを送ると紐づく） */
export function issueLinkCode(memberId) {
  const code = String(randomInt(100000, 999999));
  run('UPDATE members SET line_link_code = ? WHERE id = ?', [code, memberId]);
  return code;
}

/** 連携コードから生徒を特定して line_user_id を保存する */
export function linkByCode(code, lineUserId) {
  const member = get("SELECT * FROM members WHERE line_link_code = ? AND line_link_code <> ''", [String(code).trim()]);
  if (!member) return null;
  run("UPDATE members SET line_user_id = ?, line_link_code = '' WHERE id = ?", [lineUserId, member.id]);
  return member;
}

export function unlink(memberId) {
  run("UPDATE members SET line_user_id = '', line_link_code = '' WHERE id = ?", [memberId]);
}

/** Webhook の署名検証（LINE は本文の HMAC-SHA256 を base64 で送ってくる） */
export function verifySignature(channelSecret, body, signature) {
  if (!channelSecret || !signature) return false;
  const expected = createHmac('sha256', channelSecret).update(body).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * LINE へプッシュ送信する。
 * 資格情報が揃っていない場合は呼び出し元でメールにフォールバックする想定。
 */
export async function pushMessage({ token, to, text }) {
  if (!token) throw new Error('LINE チャネルアクセストークンが未設定です');
  const res = await fetch(PUSH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LINE 送信エラー ${res.status}: ${detail.slice(0, 200)}`);
  }
}

/** Webhook のイベントを処理する。連携コードが送られてきたら紐づける。 */
export function handleWebhookEvents(events) {
  const results = [];
  for (const event of events || []) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    const lineUserId = event.source?.userId;
    const text = String(event.message.text || '').trim();
    if (!lineUserId || !/^\d{6}$/.test(text)) continue;
    const member = linkByCode(text, lineUserId);
    results.push({ lineUserId, linked: Boolean(member), memberId: member?.id ?? null });
  }
  return results;
}
