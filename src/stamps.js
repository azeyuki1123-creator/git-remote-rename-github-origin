// 出席スタンプ（スタンプカード）のロジック。
//
// 重要な前提：スタンプは指導者だけが押せる。生徒側の画面には押印の導線を一切置かず、
// すべての付与・取り消しに「誰が押したか（granted_by / voided_by）」を記録する。
import { all, get, run } from './db.js';

export function branches() {
  return all('SELECT * FROM branches ORDER BY is_main DESC, id');
}

export function branchById(id) {
  return id ? get('SELECT * FROM branches WHERE id = ?', [id]) : null;
}

export function mainBranch() {
  return get('SELECT * FROM branches ORDER BY is_main DESC, id LIMIT 1');
}

/** 生徒が所属する支部（未設定なら本部） */
export function branchOf(member) {
  return branchById(member?.branch_id) || mainBranch();
}

/**
 * スタンプの集計。
 * - 累計（earned）… 生涯の有効スタンプ数。割引の判定に使う。
 * - 審査用（examStamps）… 支部設定が「昇級したら数え直す」なら昇級日以降の分だけ。
 */
export function stampSummary(member) {
  const branch = branchOf(member);
  const perCard = Math.max(1, branch?.stamps_per_card || 30);

  const earned = get("SELECT COUNT(*) AS c FROM stamps WHERE member_id = ? AND status = 'active'", [member.id]).c;
  const since = member.last_promoted_on || member.joined_on;
  const sincePromotion = get(
    "SELECT COUNT(*) AS c FROM stamps WHERE member_id = ? AND status = 'active' AND granted_on >= ?",
    [member.id, since],
  ).c;

  const examStamps = branch?.reset_on_promotion ? sincePromotion : earned;
  const examEligible = examStamps >= perCard;

  const completedCards = Math.floor(earned / perCard);
  // 1 枚目は審査の受験資格。2 枚目以降が 1 枚ごとに割引 1 段階。
  const discountCards = Math.min(Math.max(0, completedCards - 1), branch?.discount_max_cards ?? 6);
  const discountAmount = discountCards * (branch?.discount_per_card ?? 0);

  return {
    branch,
    perCard,
    earned,
    sincePromotion,
    examStamps,
    examEligible,
    completedCards,
    discountCards,
    discountAmount,
    // 現在の台紙の進み具合（審査用の台紙は 1 枚たまったらそこで止まる）
    progress: Math.min(examStamps, perCard),
    remaining: Math.max(0, perCard - examStamps),
  };
}

/**
 * スタンプを 1 個押す。grantedBy（指導者の user_id）は必須。
 * 同じ稽古に対する二重押印は起こらない（取り消し済みなら復活させる）。
 */
export function grantStamp({ memberId, sessionId = null, reason = '稽古出席', grantedBy, grantedOn = null }) {
  if (!grantedBy) throw new Error('スタンプの押印者が特定できません');
  const member = get('SELECT * FROM members WHERE id = ?', [memberId]);
  if (!member) throw new Error('生徒が見つかりません');

  if (sessionId) {
    const existing = get('SELECT * FROM stamps WHERE member_id = ? AND session_id = ?', [memberId, sessionId]);
    if (existing) {
      if (existing.status === 'active') return { created: false, id: existing.id };
      run(
        `UPDATE stamps SET status = 'active', granted_by = ?, voided_by = NULL, voided_at = NULL,
                void_reason = '', reason = ? WHERE id = ?`,
        [grantedBy, reason, existing.id],
      );
      return { created: true, id: existing.id, restored: true };
    }
  }

  const session = sessionId ? get('SELECT * FROM training_sessions WHERE id = ?', [sessionId]) : null;
  const info = run(
    'INSERT INTO stamps (member_id, branch_id, session_id, granted_on, reason, granted_by) VALUES (?, ?, ?, ?, ?, ?)',
    [
      memberId,
      member.branch_id,
      sessionId,
      grantedOn || session?.held_on || new Date().toISOString().slice(0, 10),
      reason,
      grantedBy,
    ],
  );
  return { created: true, id: Number(info.lastInsertRowid) };
}

/** スタンプを取り消す（行は残し、誰がなぜ取り消したかを記録する） */
export function voidStamp(stampId, userId, reason = '') {
  run(
    `UPDATE stamps SET status = 'void', voided_by = ?, voided_at = datetime('now'), void_reason = ?
     WHERE id = ? AND status = 'active'`,
    [userId, reason, stampId],
  );
}

/** ある稽古のスタンプを取り消す（出欠を欠席に変えたとき用） */
export function voidStampForSession(memberId, sessionId, userId, reason = '出欠を欠席に変更') {
  const row = get("SELECT id FROM stamps WHERE member_id = ? AND session_id = ? AND status = 'active'", [
    memberId,
    sessionId,
  ]);
  if (row) voidStamp(row.id, userId, reason);
}

export function stampHistory(memberId, limit = 40) {
  return all(
    `SELECT s.*, u.display_name AS granted_by_name, v.display_name AS voided_by_name, t.title AS session_title
     FROM stamps s
     LEFT JOIN users u ON u.id = s.granted_by
     LEFT JOIN users v ON v.id = s.voided_by
     LEFT JOIN training_sessions t ON t.id = s.session_id
     WHERE s.member_id = ? ORDER BY s.granted_on DESC, s.id DESC LIMIT ?`,
    [memberId, limit],
  );
}

/** 押印の監査ログ（道場全体・新しい順） */
export function stampAuditLog(limit = 60) {
  return all(
    `SELECT s.*, m.name AS member_name, u.display_name AS granted_by_name, v.display_name AS voided_by_name
     FROM stamps s
     JOIN members m ON m.id = s.member_id
     LEFT JOIN users u ON u.id = s.granted_by
     LEFT JOIN users v ON v.id = s.voided_by
     ORDER BY s.id DESC LIMIT ?`,
    [limit],
  );
}
