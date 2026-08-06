"use server";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { analyzeImage, isConfigured } from "@/lib/analyze";
import { UPLOAD_DIR, db, setSetting } from "@/lib/db";
import { nextReviewDate } from "@/lib/stats";

const ALLOWED_IMAGE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
} as const;

type MediaType = keyof typeof ALLOWED_IMAGE;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function saveUpload(file: File): Promise<{ storedName: string; base64: string; mediaType: MediaType }> {
  if (!(file.type in ALLOWED_IMAGE)) {
    throw new Error("対応していない画像形式です(JPEG/PNG/GIF/WebP)。");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("画像が大きすぎます(8MBまで)。");
  }
  const mediaType = file.type as MediaType;
  const buffer = Buffer.from(await file.arrayBuffer());
  const storedName = crypto.randomUUID() + ALLOWED_IMAGE[mediaType];
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), buffer);
  return { storedName, base64: buffer.toString("base64"), mediaType };
}

export async function createMistake(form: FormData) {
  const file = form.get("image");
  const memo = str(form, "memo");
  const studiedOn = str(form, "studied_on") || today();

  let stored: Awaited<ReturnType<typeof saveUpload>> | null = null;
  if (file instanceof File && file.size > 0) {
    stored = await saveUpload(file);
  }

  let subject = str(form, "subject");
  let field = str(form, "field") || null;
  let source = str(form, "source") || "その他";
  let sourceDetail = str(form, "source_detail") || null;
  let questionSummary: string | null = null;
  let correctPoint: string | null = null;
  let cause = str(form, "cause") || null;
  let keyPoints: string | null = null;
  let aiRaw: string | null = null;

  const useAi = form.get("use_ai") === "on" && stored && isConfigured();
  if (useAi && stored) {
    const a = await analyzeImage(stored.base64, stored.mediaType, memo);
    aiRaw = JSON.stringify(a);
    subject = subject || a.subject;
    field = field ?? (a.field || null);
    if (!str(form, "source")) source = a.source;
    sourceDetail = sourceDetail ?? (a.source_detail || null);
    questionSummary = a.question_summary || null;
    correctPoint = a.correct_point || null;
    cause = cause ?? (a.cause || null);
    keyPoints = a.key_points.length ? JSON.stringify(a.key_points) : null;
  }

  if (!subject) throw new Error("科目を選んでください(AI解析を使わない場合は必須です)。");

  db.prepare(
    `INSERT INTO mistakes
      (created_at, studied_on, subject, field, source, source_detail, image_path,
       question_summary, correct_point, cause, key_points, memo, ai_raw, next_review_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    new Date().toISOString(),
    studiedOn,
    subject,
    field,
    source,
    sourceDetail,
    stored?.storedName ?? null,
    questionSummary,
    correctPoint,
    cause,
    keyPoints,
    memo || null,
    aiRaw,
    nextReviewDate(0, 0),
  );

  revalidatePath("/mistakes");
  revalidatePath("/");
  redirect("/mistakes");
}

export async function reviewMistake(form: FormData) {
  const id = Number(form.get("id"));
  const understanding = Math.min(Math.max(Number(form.get("understanding")), 0), 3);
  const row = db.prepare("SELECT review_count FROM mistakes WHERE id = ?").get(id) as
    | { review_count: number }
    | undefined;
  if (!row) return;

  const count = row.review_count + 1;
  db.prepare(
    "UPDATE mistakes SET understanding = ?, review_count = ?, last_reviewed_on = ?, next_review_on = ? WHERE id = ?",
  ).run(understanding, count, today(), nextReviewDate(understanding, count), id);

  revalidatePath("/mistakes");
  revalidatePath("/");
}

export async function archiveMistake(form: FormData) {
  db.prepare("UPDATE mistakes SET archived = 1 WHERE id = ?").run(Number(form.get("id")));
  revalidatePath("/mistakes");
  revalidatePath("/analysis");
}

export async function createExamResult(form: FormData) {
  const takenOn = str(form, "taken_on") || today();
  const examType = str(form, "exam_type") || "模試";
  const examName = str(form, "exam_name");
  if (!examName) throw new Error("試験名を入力してください。");

  const insert = db.transaction(() => {
    const res = db
      .prepare("INSERT INTO exam_results (created_at, taken_on, exam_type, exam_name, memo) VALUES (?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), takenOn, examType, examName, str(form, "memo") || null);
    const resultId = res.lastInsertRowid as number;

    const stmt = db.prepare("INSERT INTO exam_scores (result_id, subject, correct, total) VALUES (?, ?, ?, ?)");
    for (const [key, value] of form.entries()) {
      if (!key.startsWith("correct__") || typeof value !== "string" || value === "") continue;
      const subject = key.slice("correct__".length);
      const total = Number(form.get(`total__${subject}`));
      const correct = Number(value);
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(correct)) continue;
      stmt.run(resultId, subject, Math.min(correct, total), total);
    }
  });
  insert();

  revalidatePath("/results");
  revalidatePath("/analysis");
  revalidatePath("/");
  redirect("/results");
}

export async function deleteExamResult(form: FormData) {
  db.prepare("DELETE FROM exam_results WHERE id = ?").run(Number(form.get("id")));
  revalidatePath("/results");
  revalidatePath("/analysis");
}

export async function createTask(form: FormData) {
  db.prepare(
    "INSERT INTO tasks (created_at, title, subject, field, scope, due_on, estimate_min, memo, auto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    new Date().toISOString(),
    str(form, "title"),
    str(form, "subject") || null,
    str(form, "field") || null,
    str(form, "scope") || "week",
    str(form, "due_on") || null,
    Number(form.get("estimate_min")) || null,
    str(form, "memo") || null,
    form.get("auto") === "1" ? 1 : 0,
  );
  revalidatePath("/plan");
  revalidatePath("/");
}

export async function setTaskStatus(form: FormData) {
  const status = str(form, "status");
  db.prepare("UPDATE tasks SET status = ?, done_at = ? WHERE id = ?").run(
    status,
    status === "done" ? today() : null,
    Number(form.get("id")),
  );
  revalidatePath("/plan");
  revalidatePath("/");
}

export async function deleteTask(form: FormData) {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(Number(form.get("id")));
  revalidatePath("/plan");
}

export async function createStudyLog(form: FormData) {
  const minutes = Number(form.get("minutes"));
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("学習時間を入力してください。");
  db.prepare(
    "INSERT INTO study_logs (created_at, studied_on, subject, minutes, material, memo) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    new Date().toISOString(),
    str(form, "studied_on") || today(),
    str(form, "subject"),
    minutes,
    str(form, "material") || null,
    str(form, "memo") || null,
  );
  revalidatePath("/");
  revalidatePath("/analysis");
}

export async function saveExamDate(form: FormData) {
  setSetting("exam_date", str(form, "exam_date"));
  revalidatePath("/");
  revalidatePath("/plan");
}
