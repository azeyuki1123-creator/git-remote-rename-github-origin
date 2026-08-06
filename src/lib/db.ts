import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

function init() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "study.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS mistakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      studied_on TEXT NOT NULL,
      subject TEXT NOT NULL,
      field TEXT,
      source TEXT NOT NULL,
      source_detail TEXT,
      image_path TEXT,
      question_summary TEXT,
      correct_point TEXT,
      cause TEXT,
      key_points TEXT,
      memo TEXT,
      ai_raw TEXT,
      understanding INTEGER NOT NULL DEFAULT 0,
      review_count INTEGER NOT NULL DEFAULT 0,
      last_reviewed_on TEXT,
      next_review_on TEXT,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mistakes_subject ON mistakes(subject);
    CREATE INDEX IF NOT EXISTS idx_mistakes_next_review ON mistakes(next_review_on);

    CREATE TABLE IF NOT EXISTS exam_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      taken_on TEXT NOT NULL,
      exam_type TEXT NOT NULL,
      exam_name TEXT NOT NULL,
      memo TEXT
    );

    CREATE TABLE IF NOT EXISTS exam_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      result_id INTEGER NOT NULL REFERENCES exam_results(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      correct INTEGER NOT NULL,
      total INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scores_result ON exam_scores(result_id);

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      title TEXT NOT NULL,
      subject TEXT,
      field TEXT,
      scope TEXT NOT NULL,
      due_on TEXT,
      estimate_min INTEGER,
      status TEXT NOT NULL DEFAULT 'todo',
      done_at TEXT,
      memo TEXT,
      auto INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_on);

    CREATE TABLE IF NOT EXISTS study_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      studied_on TEXT NOT NULL,
      subject TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      material TEXT,
      memo TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_date ON study_logs(studied_on);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

const globalForDb = globalThis as unknown as { __db?: Database.Database };
export const db = globalForDb.__db ?? init();
globalForDb.__db = db;

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
