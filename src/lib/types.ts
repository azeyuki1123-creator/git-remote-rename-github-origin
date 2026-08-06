export type Mistake = {
  id: number;
  created_at: string;
  studied_on: string;
  subject: string;
  field: string | null;
  source: string;
  source_detail: string | null;
  image_path: string | null;
  question_summary: string | null;
  correct_point: string | null;
  cause: string | null;
  key_points: string | null;
  memo: string | null;
  ai_raw: string | null;
  understanding: number;
  review_count: number;
  last_reviewed_on: string | null;
  next_review_on: string | null;
  archived: number;
};

export type ExamResult = {
  id: number;
  created_at: string;
  taken_on: string;
  exam_type: string;
  exam_name: string;
  memo: string | null;
};

export type ExamScore = {
  id: number;
  result_id: number;
  subject: string;
  correct: number;
  total: number;
};

export type Task = {
  id: number;
  created_at: string;
  title: string;
  subject: string | null;
  field: string | null;
  scope: "month" | "week" | "day";
  due_on: string | null;
  estimate_min: number | null;
  status: "todo" | "doing" | "done";
  done_at: string | null;
  memo: string | null;
  auto: number;
};

export type StudyLog = {
  id: number;
  created_at: string;
  studied_on: string;
  subject: string;
  minutes: number;
  material: string | null;
  memo: string | null;
};

export function keyPoints(m: Pick<Mistake, "key_points">): string[] {
  if (!m.key_points) return [];
  try {
    const parsed = JSON.parse(m.key_points);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
