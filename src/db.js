// SQLite への接続とスキーマ定義。
// Node 22.5 以降に同梱されている node:sqlite を使うため、外部依存はありません。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = join(here, '..');
export const DATA_DIR = process.env.DATA_DIR || join(ROOT_DIR, 'data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
export const OUTBOX_DIR = join(DATA_DIR, 'outbox');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });
mkdirSync(OUTBOX_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || join(DATA_DIR, 'dojo.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
-- 帯（級・段）。rank_order が大きいほど上位。
CREATE TABLE IF NOT EXISTS belts (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  short_name  TEXT NOT NULL,
  rank_order  INTEGER NOT NULL UNIQUE,
  color       TEXT NOT NULL DEFAULT '#cccccc',
  min_sessions INTEGER NOT NULL DEFAULT 20,   -- 次の審査までに必要な稽古出席回数
  min_months   INTEGER NOT NULL DEFAULT 3     -- 次の審査までに必要な在籍月数
);

-- ログインアカウント。role は admin(指導者) / member(生徒・保護者)。
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- 生徒名簿
CREATE TABLE IF NOT EXISTS members (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  kana          TEXT NOT NULL DEFAULT '',
  birthday      TEXT,
  gender        TEXT NOT NULL DEFAULT '',
  belt_id       INTEGER NOT NULL REFERENCES belts(id),
  joined_on     TEXT NOT NULL,
  last_promoted_on TEXT,
  phone         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  guardian_name TEXT NOT NULL DEFAULT '',
  plan          TEXT NOT NULL DEFAULT 'standard',  -- standard / premium
  status        TEXT NOT NULL DEFAULT 'active',    -- active / rest / left
  exam_flag     INTEGER NOT NULL DEFAULT 0,        -- 指導者が手動で審査対象に指定
  notes         TEXT NOT NULL DEFAULT ''
);

-- 稽古（クラス）1回分
CREATE TABLE IF NOT EXISTS training_sessions (
  id       INTEGER PRIMARY KEY,
  held_on  TEXT NOT NULL,
  title    TEXT NOT NULL DEFAULT '通常稽古',
  place    TEXT NOT NULL DEFAULT '',
  note     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS attendance (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'present',   -- present / late / absent
  UNIQUE (session_id, member_id)
);

-- 帯ごとの技術項目（習熟度チェックリスト）
CREATE TABLE IF NOT EXISTS skill_items (
  id       INTEGER PRIMARY KEY,
  belt_id  INTEGER NOT NULL REFERENCES belts(id) ON DELETE CASCADE,
  category TEXT NOT NULL,          -- 基本 / 型 / 組手 / 体力
  name     TEXT NOT NULL,
  sort_no  INTEGER NOT NULL DEFAULT 0
);

-- 習熟度。level 0=未着手 1=練習中 2=できる 3=審査合格レベル
CREATE TABLE IF NOT EXISTS assessments (
  id            INTEGER PRIMARY KEY,
  member_id     INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  skill_item_id INTEGER NOT NULL REFERENCES skill_items(id) ON DELETE CASCADE,
  level         INTEGER NOT NULL DEFAULT 0,
  assessed_on   TEXT NOT NULL DEFAULT (date('now')),
  comment       TEXT NOT NULL DEFAULT '',
  UNIQUE (member_id, skill_item_id)
);

-- 審査会
CREATE TABLE IF NOT EXISTS exams (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  held_on TEXT NOT NULL,
  place   TEXT NOT NULL DEFAULT '',
  note    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS exam_candidates (
  id             INTEGER PRIMARY KEY,
  exam_id        INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  member_id      INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  target_belt_id INTEGER REFERENCES belts(id),
  decision       TEXT NOT NULL DEFAULT 'pending',  -- pending / passed / failed / declined
  comment        TEXT NOT NULL DEFAULT '',
  UNIQUE (exam_id, member_id)
);

-- 会員向けコンテンツ（記事・動画）。帯レベルと有料プランでアクセス制御。
CREATE TABLE IF NOT EXISTS contents (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT '空手',   -- 空手 / 栄養 / トレーニング / 仕事・法律 など
  summary      TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  video_url    TEXT NOT NULL DEFAULT '',
  min_belt_id  INTEGER REFERENCES belts(id),   -- NULL なら全会員に公開
  is_premium   INTEGER NOT NULL DEFAULT 0,
  published    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 生徒がスマホで撮った動画の提出とフィードバック
CREATE TABLE IF NOT EXISTS video_submissions (
  id         INTEGER PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  file_name  TEXT NOT NULL DEFAULT '',
  url        TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending / reviewed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS video_feedback (
  id            INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES video_submissions(id) ON DELETE CASCADE,
  author_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  comment       TEXT NOT NULL,
  score         INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 試合・イベント
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT '大会',   -- 大会 / 合宿 / 講習会 / その他
  starts_on   TEXT NOT NULL,
  place       TEXT NOT NULL DEFAULT '',
  deadline_on TEXT,
  fee         INTEGER NOT NULL DEFAULT 0,
  detail      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS event_entries (
  id        INTEGER PRIMARY KEY,
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status    TEXT NOT NULL DEFAULT 'entry',   -- entry / cancel
  note      TEXT NOT NULL DEFAULT '',
  UNIQUE (event_id, member_id)
);

-- メール
CREATE TABLE IF NOT EXISTS mail_templates (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  subject TEXT NOT NULL,
  body    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_messages (
  id         INTEGER PRIMARY KEY,
  member_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
  to_email   TEXT NOT NULL,
  to_name    TEXT NOT NULL DEFAULT '',
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued',   -- queued / sent / failed
  error      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_attendance_member ON attendance(member_id);
CREATE INDEX IF NOT EXISTS idx_assessments_member ON assessments(member_id);
CREATE INDEX IF NOT EXISTS idx_contents_belt ON contents(min_belt_id);
CREATE INDEX IF NOT EXISTS idx_mail_status ON mail_messages(status);
`;

export function migrate() {
  db.exec(SCHEMA);
}

migrate();

/** SELECT 複数行 */
export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

/** SELECT 1行（無ければ undefined） */
export function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

/** INSERT / UPDATE / DELETE */
export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

/** 複数の書き込みをまとめて実行する */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
