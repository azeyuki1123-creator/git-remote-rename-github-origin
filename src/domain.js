// 道場運営のドメインロジック（審査対象判定・コンテンツ開放判定・ポイント計算）。
import { all, get } from './db.js';

export function belts() {
  return all('SELECT * FROM belts ORDER BY rank_order');
}

export function beltById(id) {
  return id ? get('SELECT * FROM belts WHERE id = ?', [id]) : null;
}

export function nextBelt(belt) {
  if (!belt) return null;
  return get('SELECT * FROM belts WHERE rank_order > ? ORDER BY rank_order LIMIT 1', [belt.rank_order]);
}

/** その帯を取得した日（未設定なら入会日）を基準日として返す */
export function baseDate(member) {
  return member.last_promoted_on || member.joined_on;
}

export function monthsSince(dateStr) {
  if (!dateStr) return 0;
  const from = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) return 0;
  const now = new Date();
  const months =
    (now.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - from.getUTCMonth()) +
    (now.getUTCDate() >= from.getUTCDate() ? 0 : -1);
  return Math.max(0, months);
}

/**
 * 審査対象かどうかの判定。
 * 出席回数・在籍月数・現在の帯の技術項目の習熟度の 3 条件で評価する。
 */
export function examReadiness(member) {
  const belt = beltById(member.belt_id);
  const since = baseDate(member);

  const attendance = get(
    `SELECT COUNT(*) AS c FROM attendance a
     JOIN training_sessions t ON t.id = a.session_id
     WHERE a.member_id = ? AND a.status IN ('present','late') AND t.held_on >= ?`,
    [member.id, since],
  ).c;

  const months = monthsSince(since);

  const totalSkills = get('SELECT COUNT(*) AS c FROM skill_items WHERE belt_id = ?', [member.belt_id]).c;
  const clearedSkills = get(
    `SELECT COUNT(*) AS c FROM assessments a
     JOIN skill_items s ON s.id = a.skill_item_id
     WHERE a.member_id = ? AND s.belt_id = ? AND a.level >= 2`,
    [member.id, member.belt_id],
  ).c;
  const skillRate = totalSkills === 0 ? 0 : clearedSkills / totalSkills;

  const needSessions = belt?.min_sessions ?? 20;
  const needMonths = belt?.min_months ?? 3;
  const checks = [
    { label: '出席回数', ok: attendance >= needSessions, detail: `${attendance} / ${needSessions} 回` },
    { label: '在籍期間', ok: months >= needMonths, detail: `${months} / ${needMonths} ヶ月` },
    {
      label: '習熟度',
      ok: totalSkills > 0 && skillRate >= 0.8,
      detail: `${clearedSkills} / ${totalSkills} 項目（${Math.round(skillRate * 100)}%）`,
    },
  ];

  const autoReady = checks.every((c) => c.ok);
  return {
    belt,
    nextBelt: nextBelt(belt),
    attendance,
    months,
    skillRate,
    clearedSkills,
    totalSkills,
    checks,
    autoReady,
    ready: autoReady || member.exam_flag === 1,
    manual: member.exam_flag === 1,
    progress: Math.min(
      1,
      (Math.min(1, attendance / needSessions) + Math.min(1, months / needMonths) + Math.min(1, skillRate / 0.8)) / 3,
    ),
  };
}

/** 審査対象者の一覧（在籍中の生徒のみ） */
export function examCandidates() {
  const members = all("SELECT * FROM members WHERE status = 'active' ORDER BY id");
  return members
    .map((m) => ({ member: m, readiness: examReadiness(m) }))
    .filter((row) => row.readiness.ready);
}

/**
 * コンテンツを閲覧できるか。
 * 指導者は常に可。生徒は「必要な帯以上」かつ「有料コンテンツならプレミアム会員」であること。
 */
export function canViewContent(user, content) {
  if (!content.published && user?.role !== 'admin') return { ok: false, reason: '未公開のコンテンツです' };
  if (!user) return { ok: false, reason: '会員ログインが必要です' };
  if (user.role === 'admin') return { ok: true };
  const member = user.member;
  if (!member) return { ok: false, reason: '名簿と紐づいていないアカウントです' };

  if (content.min_belt_id) {
    const required = beltById(content.min_belt_id);
    const mine = beltById(member.belt_id);
    if (!mine || !required || mine.rank_order < required.rank_order) {
      return { ok: false, reason: `${required?.name ?? '上位帯'}以上で解放されます` };
    }
  }
  if (content.is_premium && member.plan !== 'premium') {
    return { ok: false, reason: 'プレミアム会員向けコンテンツです' };
  }
  return { ok: true };
}

/** 生徒から見たコンテンツ一覧（ロック状態つき） */
export function contentsFor(user, { category = '' } = {}) {
  const params = [];
  let sql = 'SELECT * FROM contents';
  const where = [];
  if (user?.role !== 'admin') where.push('published = 1');
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY created_at DESC, id DESC';
  return all(sql, params).map((c) => ({ ...c, access: canViewContent(user, c) }));
}

/** ゲーム感覚の指標：出席・習熟度・動画提出からポイントを算出する */
export function memberPoints(memberId) {
  const attendance = get(
    "SELECT COUNT(*) AS c FROM attendance WHERE member_id = ? AND status IN ('present','late')",
    [memberId],
  ).c;
  const skill = get('SELECT COALESCE(SUM(level), 0) AS s FROM assessments WHERE member_id = ?', [memberId]).s;
  const videos = get('SELECT COUNT(*) AS c FROM video_submissions WHERE member_id = ?', [memberId]).c;
  const events = get("SELECT COUNT(*) AS c FROM event_entries WHERE member_id = ? AND status = 'entry'", [memberId]).c;
  const total = attendance * 10 + skill * 15 + videos * 20 + events * 30;
  return { attendance, skill, videos, events, total };
}

export function memberById(id) {
  return get('SELECT * FROM members WHERE id = ?', [id]);
}

export function memberWithBelt(id) {
  return get(
    `SELECT m.*, b.name AS belt_name, b.color AS belt_color, b.rank_order
     FROM members m JOIN belts b ON b.id = m.belt_id WHERE m.id = ?`,
    [id],
  );
}

export function listMembers({ status = '', beltId = '', keyword = '' } = {}) {
  const params = [];
  const where = [];
  if (status) {
    where.push('m.status = ?');
    params.push(status);
  }
  if (beltId) {
    where.push('m.belt_id = ?');
    params.push(Number(beltId));
  }
  if (keyword) {
    where.push('(m.name LIKE ? OR m.kana LIKE ? OR m.email LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  let sql = `SELECT m.*, b.name AS belt_name, b.color AS belt_color, b.rank_order
             FROM members m JOIN belts b ON b.id = m.belt_id`;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY b.rank_order DESC, m.kana, m.id';
  return all(sql, params);
}
