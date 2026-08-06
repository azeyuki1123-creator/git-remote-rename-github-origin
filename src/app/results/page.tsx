import { createExamResult, deleteExamResult } from "@/app/actions";
import { Bar, Card, Empty, PageTitle, SectionTitle } from "@/components/ui";
import { db } from "@/lib/db";
import { examTrend } from "@/lib/stats";
import { SUBJECTS } from "@/lib/subjects";
import type { ExamResult, ExamScore } from "@/lib/types";

export const dynamic = "force-dynamic";

export default function ResultsPage() {
  const results = db.prepare("SELECT * FROM exam_results ORDER BY taken_on DESC").all() as ExamResult[];
  const scores = db.prepare("SELECT * FROM exam_scores").all() as ExamScore[];
  const byResult = new Map<number, ExamScore[]>();
  for (const s of scores) {
    const list = byResult.get(s.result_id) ?? [];
    list.push(s);
    byResult.set(s.result_id, list);
  }
  const trend = examTrend();

  return (
    <>
      <PageTitle title="成績" sub="模試・答練・過去問演習の結果を科目別に記録します。" />

      {trend.length > 0 && (
        <section className="mb-6">
          <SectionTitle>全体の正答率の推移</SectionTitle>
          <Card className="space-y-2">
            {trend.map((t, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted">{t.taken_on}</span>
                <span className="w-32 shrink-0 truncate">{t.exam_name}</span>
                <Bar value={t.correct} max={t.total} label={`${Math.round(t.accuracy * 100)}%`} />
              </div>
            ))}
          </Card>
        </section>
      )}

      <section className="mb-6">
        <SectionTitle>結果を記録する</SectionTitle>
        <form action={createExamResult}>
          <Card className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="taken_on">受験日</label>
                <input id="taken_on" name="taken_on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
              <div>
                <label htmlFor="exam_type">種別</label>
                <select id="exam_type" name="exam_type" defaultValue="模試">
                  <option>模試</option>
                  <option>答練</option>
                  <option>過去問演習</option>
                </select>
              </div>
              <div>
                <label htmlFor="exam_name">試験名</label>
                <input id="exam_name" name="exam_name" required placeholder="第2回 全国模試" />
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm text-muted">科目別の正答数／問題数(受けた科目だけ入力すればOK)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUBJECTS.filter((s) => s.questions > 0).map((s) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <span className="flex-1 text-sm">{s.name}</span>
                    <input
                      name={`correct__${s.name}`}
                      type="number"
                      min={0}
                      placeholder="正答"
                      className="w-20"
                      aria-label={`${s.name} 正答数`}
                    />
                    <span className="text-muted">/</span>
                    <input
                      name={`total__${s.name}`}
                      type="number"
                      min={1}
                      defaultValue={s.questions}
                      className="w-20"
                      aria-label={`${s.name} 問題数`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="memo">メモ</label>
              <textarea id="memo" name="memo" rows={2} placeholder="時間配分、手応えなど" />
            </div>

            <button type="submit" className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-white">
              保存する
            </button>
          </Card>
        </form>
      </section>

      <section>
        <SectionTitle>記録した結果</SectionTitle>
        {results.length === 0 ? (
          <Empty>まだ成績が登録されていません。</Empty>
        ) : (
          <ul className="space-y-3">
            {results.map((r) => {
              const list = (byResult.get(r.id) ?? []).sort((a, b) => a.correct / a.total - b.correct / b.total);
              const correct = list.reduce((a, s) => a + s.correct, 0);
              const total = list.reduce((a, s) => a + s.total, 0);
              return (
                <li key={r.id}>
                  <Card className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.exam_name}</span>
                      <span className="text-xs text-muted">
                        {r.exam_type}・{r.taken_on}
                      </span>
                      <span className="ml-auto text-sm tabular-nums">
                        {correct}/{total}
                        {total > 0 && ` (${Math.round((correct / total) * 100)}%)`}
                      </span>
                    </div>
                    {list.map((s) => (
                      <div key={s.id} className="flex items-center gap-3 text-sm">
                        <span className="w-32 shrink-0 text-xs">{s.subject}</span>
                        <Bar value={s.correct} max={s.total} label={`${s.correct}/${s.total}`} />
                      </div>
                    ))}
                    {r.memo && <p className="text-sm text-muted">{r.memo}</p>}
                    <form action={deleteExamResult} className="text-right">
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-xs text-muted hover:underline">
                        削除
                      </button>
                    </form>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
