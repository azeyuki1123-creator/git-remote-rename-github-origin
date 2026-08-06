import { db } from "./db";
import { SUBJECTS } from "./subjects";

export type SubjectStat = {
  subject: string;
  slot: string;
  questions: number;
  mistakes: number;
  attempted: number;
  correct: number;
  accuracy: number | null;
  /** 現状の正答率のままだと本試験で落とすと見込まれる問数 */
  expectedLoss: number;
  minutes: number;
  /** 成績も誤答ログも無い科目。expectedLoss が 0 でも「得意」ではない。 */
  unmeasured: boolean;
};

/** 科目ごとの苦手度。expectedLoss の降順で返す。 */
export function subjectStats(): SubjectStat[] {
  const mistakes = new Map<string, number>();
  for (const r of db
    .prepare("SELECT subject, COUNT(*) AS n FROM mistakes WHERE archived = 0 GROUP BY subject")
    .all() as { subject: string; n: number }[]) {
    mistakes.set(r.subject, r.n);
  }

  const scores = new Map<string, { correct: number; total: number }>();
  for (const r of db
    .prepare("SELECT subject, SUM(correct) AS c, SUM(total) AS t FROM exam_scores GROUP BY subject")
    .all() as { subject: string; c: number; t: number }[]) {
    scores.set(r.subject, { correct: r.c, total: r.t });
  }

  const minutes = new Map<string, number>();
  for (const r of db
    .prepare("SELECT subject, SUM(minutes) AS m FROM study_logs GROUP BY subject")
    .all() as { subject: string; m: number }[]) {
    minutes.set(r.subject, r.m);
  }

  return SUBJECTS.map((s) => {
    const score = scores.get(s.name);
    const accuracy = score && score.total > 0 ? score.correct / score.total : null;
    const mistakeCount = mistakes.get(s.name) ?? 0;
    // 成績未入力の科目は誤答ログの多さで代用する
    const missRate = accuracy !== null ? 1 - accuracy : Math.min(mistakeCount / 10, 1);
    return {
      subject: s.name,
      slot: s.slot,
      questions: s.questions,
      mistakes: mistakeCount,
      attempted: score?.total ?? 0,
      correct: score?.correct ?? 0,
      accuracy,
      expectedLoss: Math.round(missRate * s.questions * 10) / 10,
      minutes: minutes.get(s.name) ?? 0,
      unmeasured: accuracy === null && mistakeCount === 0,
    };
  }).sort((a, b) => b.expectedLoss - a.expectedLoss || b.mistakes - a.mistakes);
}

export type FieldStat = { subject: string; field: string; mistakes: number };

/** 分野ごとの誤答数。多い順。 */
export function fieldStats(subject?: string): FieldStat[] {
  const sql = subject
    ? "SELECT subject, field, COUNT(*) AS n FROM mistakes WHERE archived = 0 AND field IS NOT NULL AND subject = ? GROUP BY subject, field ORDER BY n DESC"
    : "SELECT subject, field, COUNT(*) AS n FROM mistakes WHERE archived = 0 AND field IS NOT NULL GROUP BY subject, field ORDER BY n DESC";
  const rows = (subject ? db.prepare(sql).all(subject) : db.prepare(sql).all()) as {
    subject: string;
    field: string;
    n: number;
  }[];
  return rows.map((r) => ({ subject: r.subject, field: r.field, mistakes: r.n }));
}

export type CauseStat = { cause: string; count: number };

export function causeStats(): CauseStat[] {
  return (
    db
      .prepare(
        "SELECT cause, COUNT(*) AS n FROM mistakes WHERE archived = 0 AND cause IS NOT NULL GROUP BY cause ORDER BY n DESC",
      )
      .all() as { cause: string; n: number }[]
  ).map((r) => ({ cause: r.cause, count: r.n }));
}

export type ExamTrend = {
  taken_on: string;
  exam_name: string;
  exam_type: string;
  correct: number;
  total: number;
  accuracy: number;
};

export function examTrend(): ExamTrend[] {
  return (
    db
      .prepare(`
        SELECT r.taken_on, r.exam_name, r.exam_type,
               COALESCE(SUM(s.correct), 0) AS correct,
               COALESCE(SUM(s.total), 0) AS total
        FROM exam_results r
        LEFT JOIN exam_scores s ON s.result_id = r.id
        GROUP BY r.id
        HAVING total > 0
        ORDER BY r.taken_on ASC
      `)
      .all() as { taken_on: string; exam_name: string; exam_type: string; correct: number; total: number }[]
  ).map((r) => ({ ...r, accuracy: r.correct / r.total }));
}

/** 理解度と復習回数から次回復習日を決める(間隔反復)。 */
export function nextReviewDate(understanding: number, reviewCount: number, from = new Date()): string {
  const base = [1, 3, 7, 21][Math.min(Math.max(understanding, 0), 3)];
  const days = base * Math.max(1, reviewCount);
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysUntilExam(examDate: string | null): number | null {
  if (!examDate) return null;
  const diff = new Date(examDate).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(diff / 86_400_000);
}

export type Suggestion = {
  title: string;
  subject: string;
  field: string | null;
  scope: "month" | "week" | "day";
  estimate_min: number;
  reason: string;
};

/** 弱点分析から「今やるべきこと」を組み立てる。 */
export function suggestTasks(): Suggestion[] {
  const out: Suggestion[] = [];
  const subjects = subjectStats();
  const fields = fieldStats();

  for (const s of subjects.slice(0, 3)) {
    if (s.expectedLoss < 0.5) continue;
    out.push({
      title: `${s.subject}の総復習`,
      subject: s.subject,
      field: null,
      scope: "month",
      estimate_min: 240,
      reason:
        s.accuracy !== null
          ? `正答率${Math.round(s.accuracy * 100)}%。このままだと本試験で約${s.expectedLoss}問の失点。`
          : `誤答${s.mistakes}件。出題数${s.questions}問の科目なので影響が大きい。`,
    });
  }

  for (const f of fields.slice(0, 5)) {
    if (f.mistakes < 2) continue;
    out.push({
      title: `${f.subject}「${f.field}」を潰す`,
      subject: f.subject,
      field: f.field,
      scope: "week",
      estimate_min: 90,
      reason: `この分野だけで誤答${f.mistakes}件。集中的にやれば伸びしろが大きい。`,
    });
  }

  const due = db
    .prepare("SELECT COUNT(*) AS n FROM mistakes WHERE archived = 0 AND next_review_on IS NOT NULL AND next_review_on <= date('now')")
    .get() as { n: number };
  if (due.n > 0) {
    out.push({
      title: `復習期限が来た苦手問題 ${due.n}件を解き直す`,
      subject: "全科目",
      field: null,
      scope: "day",
      estimate_min: Math.min(due.n * 5, 120),
      reason: "間隔反復の復習日を過ぎている。忘却する前に解き直す。",
    });
  }

  // 出題数の割に手が回っていない科目を拾う
  const totalMinutes = subjects.reduce((a, s) => a + s.minutes, 0);
  if (totalMinutes > 0) {
    for (const s of subjects) {
      if (s.questions === 0) continue;
      const share = s.minutes / totalMinutes;
      const target = s.questions / 70;
      if (share < target * 0.4) {
        out.push({
          title: `${s.subject}に時間を割く`,
          subject: s.subject,
          field: null,
          scope: "week",
          estimate_min: 120,
          reason: `出題は${s.questions}問(全体の${Math.round(target * 100)}%)なのに学習時間は${Math.round(share * 100)}%しかない。`,
        });
      }
    }
  }

  return out;
}

/** 直近 days 日を、記録のない日も 0 分として埋めて返す。 */
export function studyMinutesByDay(days = 30): { date: string; minutes: number }[] {
  const rows = db
    .prepare(
      `SELECT studied_on AS date, SUM(minutes) AS minutes FROM study_logs
       WHERE studied_on >= date('now', ?) GROUP BY studied_on`,
    )
    .all(`-${days - 1} days`) as { date: string; minutes: number }[];
  const found = new Map(rows.map((r) => [r.date, r.minutes]));

  const out: { date: string; minutes: number }[] = [];
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const date = d.toISOString().slice(0, 10);
    out.push({ date, minutes: found.get(date) ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}
