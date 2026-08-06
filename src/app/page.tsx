import Link from "next/link";
import { createStudyLog, setTaskStatus } from "@/app/actions";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/ui";
import { db, getSetting } from "@/lib/db";
import { daysUntilExam, subjectStats } from "@/lib/stats";
import { SUBJECT_NAMES } from "@/lib/subjects";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const examDate = getSetting("exam_date");
  const remaining = daysUntilExam(examDate);

  const dueReview = db
    .prepare(
      "SELECT COUNT(*) AS n FROM mistakes WHERE archived = 0 AND next_review_on IS NOT NULL AND next_review_on <= date('now')",
    )
    .get() as { n: number };
  const openMistakes = db.prepare("SELECT COUNT(*) AS n FROM mistakes WHERE archived = 0").get() as { n: number };
  const weekMinutes = db
    .prepare("SELECT COALESCE(SUM(minutes), 0) AS m FROM study_logs WHERE studied_on >= date('now', '-6 days')")
    .get() as { m: number };

  const todayTasks = db
    .prepare("SELECT * FROM tasks WHERE status != 'done' AND scope = 'day' ORDER BY due_on IS NULL, due_on LIMIT 10")
    .all() as Task[];
  const weakest = subjectStats()
    .filter((s) => s.expectedLoss > 0)
    .slice(0, 3);

  const stats = [
    { label: "本試験まで", value: remaining !== null ? `${remaining}日` : "未設定", href: "/plan" },
    { label: "復習期限", value: `${dueReview.n}件`, href: "/mistakes?filter=due" },
    { label: "苦手ストック", value: `${openMistakes.n}件`, href: "/mistakes" },
    { label: "直近7日", value: `${Math.round((weekMinutes.m / 60) * 10) / 10}h`, href: "/analysis" },
  ];

  return (
    <>
      <PageTitle title="今日の学習" />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="h-full">
              <p className="text-xs text-muted">{s.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{s.value}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Link href="/mistakes/new">
          <Card className="h-full border-accent/40">
            <p className="font-medium text-accent">間違えたところを記録</p>
            <p className="mt-1 text-sm text-muted">写真を撮って送ると、科目・分野・論点をAIが読み取ります。</p>
          </Card>
        </Link>
        <Link href="/results">
          <Card className="h-full">
            <p className="font-medium">模試・答練の結果を入力</p>
            <p className="mt-1 text-sm text-muted">科目別の正答数を入れると弱点が数値で出ます。</p>
          </Card>
        </Link>
      </div>

      {weakest.length > 0 && (
        <section className="mb-6">
          <SectionTitle>いま一番効く3科目</SectionTitle>
          <Card className="divide-y divide-line">
            {weakest.map((s) => (
              <div key={s.subject} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <Link href={`/mistakes?subject=${encodeURIComponent(s.subject)}`} className="text-sm hover:underline">
                  {s.subject}
                </Link>
                <span className="text-xs text-muted">
                  {s.accuracy !== null ? `正答率${Math.round(s.accuracy * 100)}%` : `誤答${s.mistakes}件`}
                </span>
                <span className="ml-auto text-sm font-medium tabular-nums text-accent">−{s.expectedLoss}問</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      <section className="mb-6">
        <SectionTitle>今日やること</SectionTitle>
        {todayTasks.length === 0 ? (
          <Empty>
            <Link href="/plan" className="text-accent underline">
              計画
            </Link>
            から、分析にもとづくタスクを追加できます。
          </Empty>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {todayTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2">
                  <form action={setTaskStatus}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="status" value="done" />
                    <button type="submit" aria-label="完了にする" className="h-5 w-5 rounded border border-line text-xs" />
                  </form>
                  <span className="flex-1 text-sm">{t.title}</span>
                  {t.estimate_min && <span className="text-xs text-muted">{t.estimate_min}分</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle>学習時間を記録する</SectionTitle>
        <form action={createStudyLog}>
          <Card className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label htmlFor="studied_on">日付</label>
                <input
                  id="studied_on"
                  name="studied_on"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div>
                <label htmlFor="log_subject">科目</label>
                <select id="log_subject" name="subject" required defaultValue="">
                  <option value="" disabled>
                    選択
                  </option>
                  {SUBJECT_NAMES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="minutes">時間(分)</label>
                <input id="minutes" name="minutes" type="number" min={5} step={5} required placeholder="60" />
              </div>
              <div>
                <label htmlFor="material">教材</label>
                <input id="material" name="material" placeholder="オートマ / 過去問" />
              </div>
            </div>
            <button type="submit" className="w-full rounded-lg border border-line px-4 py-2 text-sm font-medium">
              記録する
            </button>
          </Card>
        </form>
      </section>
    </>
  );
}
