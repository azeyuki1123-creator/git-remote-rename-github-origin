import { createTask, deleteTask, saveExamDate, setTaskStatus } from "@/app/actions";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/ui";
import { db, getSetting } from "@/lib/db";
import { daysUntilExam, suggestTasks } from "@/lib/stats";
import { SUBJECT_NAMES } from "@/lib/subjects";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCOPES = [
  { key: "month", label: "今月やること" },
  { key: "week", label: "今週やること" },
  { key: "day", label: "今日やること" },
] as const;

function TaskRow({ t }: { t: Task }) {
  const overdue = t.status !== "done" && t.due_on && t.due_on < new Date().toISOString().slice(0, 10);
  return (
    <li className="flex items-start gap-2 py-2">
      <form action={setTaskStatus} className="pt-0.5">
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="status" value={t.status === "done" ? "todo" : "done"} />
        <button
          type="submit"
          aria-label={t.status === "done" ? "未完了に戻す" : "完了にする"}
          className={`h-5 w-5 rounded border ${
            t.status === "done" ? "border-accent bg-accent text-white" : "border-line"
          } text-xs leading-none`}
        >
          {t.status === "done" ? "✓" : ""}
        </button>
      </form>
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${t.status === "done" ? "text-muted line-through" : ""}`}>{t.title}</p>
        <p className="text-xs text-muted">
          {[t.subject, t.field, t.estimate_min && `${t.estimate_min}分`, t.due_on && `期限 ${t.due_on}`]
            .filter(Boolean)
            .join(" ・ ")}
          {overdue && <span className="ml-1 text-accent">期限切れ</span>}
        </p>
        {t.memo && <p className="mt-0.5 text-xs text-muted">{t.memo}</p>}
      </div>
      <form action={deleteTask}>
        <input type="hidden" name="id" value={t.id} />
        <button type="submit" className="text-xs text-muted hover:underline">
          削除
        </button>
      </form>
    </li>
  );
}

export default function PlanPage() {
  const tasks = db
    .prepare("SELECT * FROM tasks ORDER BY status = 'done', due_on IS NULL, due_on, id DESC")
    .all() as Task[];
  const examDate = getSetting("exam_date");
  const remaining = daysUntilExam(examDate);
  const suggestions = suggestTasks();
  const existing = new Set(tasks.map((t) => t.title));

  return (
    <>
      <PageTitle
        title="計画"
        sub={
          remaining !== null
            ? `本試験まで残り ${remaining} 日（${examDate}）`
            : "本試験の日付を入れると残り日数が出ます。"
        }
      />

      <section className="mb-6">
        <form action={saveExamDate}>
          <Card className="flex items-end gap-3">
            <div className="flex-1">
              <label htmlFor="exam_date">本試験の日</label>
              <input id="exam_date" name="exam_date" type="date" defaultValue={examDate ?? ""} />
            </div>
            <button type="submit" className="rounded-lg border border-line px-3 py-2 text-sm">
              保存
            </button>
          </Card>
        </form>
      </section>

      {suggestions.length > 0 && (
        <section className="mb-6">
          <SectionTitle>分析から出てきた「やるべきこと」</SectionTitle>
          <Card className="divide-y divide-line">
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-muted">{s.reason}</p>
                </div>
                <form action={createTask}>
                  <input type="hidden" name="title" value={s.title} />
                  <input type="hidden" name="subject" value={s.subject} />
                  <input type="hidden" name="field" value={s.field ?? ""} />
                  <input type="hidden" name="scope" value={s.scope} />
                  <input type="hidden" name="estimate_min" value={s.estimate_min} />
                  <input type="hidden" name="memo" value={s.reason} />
                  <input type="hidden" name="auto" value="1" />
                  <button
                    type="submit"
                    disabled={existing.has(s.title)}
                    className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    {existing.has(s.title) ? "追加済み" : "追加"}
                  </button>
                </form>
              </div>
            ))}
          </Card>
        </section>
      )}

      {SCOPES.map((scope) => {
        const list = tasks.filter((t) => t.scope === scope.key);
        return (
          <section key={scope.key} className="mb-6">
            <SectionTitle>
              {scope.label}（{list.filter((t) => t.status !== "done").length}件）
            </SectionTitle>
            {list.length === 0 ? (
              <Empty>まだありません。</Empty>
            ) : (
              <Card>
                <ul className="divide-y divide-line">
                  {list.map((t) => (
                    <TaskRow key={t.id} t={t} />
                  ))}
                </ul>
              </Card>
            )}
          </section>
        );
      })}

      <section>
        <SectionTitle>自分でタスクを追加する</SectionTitle>
        <form action={createTask}>
          <Card className="space-y-3">
            <div>
              <label htmlFor="title">やること</label>
              <input id="title" name="title" required placeholder="不動産登記法の記述式を3問解く" />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label htmlFor="scope">区分</label>
                <select id="scope" name="scope" defaultValue="week">
                  <option value="month">月</option>
                  <option value="week">週</option>
                  <option value="day">日</option>
                </select>
              </div>
              <div>
                <label htmlFor="task_subject">科目</label>
                <select id="task_subject" name="subject" defaultValue="">
                  <option value="">指定しない</option>
                  {SUBJECT_NAMES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="due_on">期限</label>
                <input id="due_on" name="due_on" type="date" />
              </div>
              <div>
                <label htmlFor="estimate_min">見込み(分)</label>
                <input id="estimate_min" name="estimate_min" type="number" min={5} step={5} placeholder="60" />
              </div>
            </div>
            <button type="submit" className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-white">
              追加する
            </button>
          </Card>
        </form>
      </section>
    </>
  );
}
