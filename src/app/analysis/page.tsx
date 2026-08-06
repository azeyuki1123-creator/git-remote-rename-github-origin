import Link from "next/link";
import { Bar, Card, Empty, PageTitle, SectionTitle } from "@/components/ui";
import { causeStats, examTrend, fieldStats, studyMinutesByDay, subjectStats } from "@/lib/stats";
import { TOTAL_CHOICE_QUESTIONS } from "@/lib/subjects";

export const dynamic = "force-dynamic";

export default function AnalysisPage() {
  const subjects = subjectStats();
  const fields = fieldStats().slice(0, 12);
  const causes = causeStats();
  const trend = examTrend();
  const daily = studyMinutesByDay(30);

  const totalLoss = Math.round(subjects.reduce((a, s) => a + s.expectedLoss, 0) * 10) / 10;
  const hasData = subjects.some((s) => s.mistakes > 0 || s.attempted > 0);
  const maxField = fields[0]?.mistakes ?? 1;
  const maxCause = causes[0]?.count ?? 1;
  const maxMinutes = Math.max(...daily.map((d) => d.minutes), 1);

  if (!hasData) {
    return (
      <>
        <PageTitle title="傾向分析" />
        <Empty>
          分析には記録が必要です。まず
          <Link href="/mistakes/new" className="text-accent underline">
            間違えたところ
          </Link>
          か
          <Link href="/results" className="text-accent underline">
            模試の結果
          </Link>
          を入れてください。
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageTitle
        title="傾向分析"
        sub={`いまの正答率のままだと、択一${TOTAL_CHOICE_QUESTIONS}問中およそ${totalLoss}問を落とす計算です。`}
      />

      <section className="mb-6">
        <SectionTitle>科目別の失点見込み(多い順)</SectionTitle>
        <Card className="space-y-3">
          {subjects
            .filter((s) => s.questions > 0)
            .map((s) => (
              <div key={s.subject} className="space-y-1">
                <div className="flex items-baseline gap-2 text-sm">
                  <Link href={`/mistakes?subject=${encodeURIComponent(s.subject)}`} className="hover:underline">
                    {s.subject}
                  </Link>
                  <span className="text-xs text-muted">
                    出題{s.questions}問
                    {s.accuracy !== null && ` ・正答率${Math.round(s.accuracy * 100)}%`}
                    {s.mistakes > 0 && ` ・誤答ログ${s.mistakes}件`}
                  </span>
                  <span
                    className={`ml-auto text-sm font-medium tabular-nums ${s.unmeasured ? "text-muted" : "text-accent"}`}
                  >
                    {s.unmeasured ? "未計測" : `−${s.expectedLoss}問`}
                  </span>
                </div>
                <Bar value={s.expectedLoss} max={Math.max(subjects[0].expectedLoss, 1)} />
              </div>
            ))}
          <p className="pt-1 text-xs text-muted">
            失点見込み = (1 − 正答率) × 本試験の出題数。成績が未入力の科目は誤答ログの件数で代用し、どちらも無い科目は
            「未計測」と表示しています(得意という意味ではありません)。
          </p>
        </Card>
      </section>

      {fields.length > 0 && (
        <section className="mb-6">
          <SectionTitle>分野別の誤答(上位)</SectionTitle>
          <Card className="space-y-2">
            {fields.map((f) => (
              <div key={`${f.subject}-${f.field}`} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0 truncate text-xs">
                  <span className="text-muted">{f.subject}</span> {f.field}
                </span>
                <Bar value={f.mistakes} max={maxField} label={`${f.mistakes}件`} />
              </div>
            ))}
          </Card>
        </section>
      )}

      {causes.length > 0 && (
        <section className="mb-6">
          <SectionTitle>間違えた原因の内訳</SectionTitle>
          <Card className="space-y-2">
            {causes.map((c) => (
              <div key={c.cause} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0 truncate text-xs">{c.cause}</span>
                <Bar value={c.count} max={maxCause} label={`${c.count}件`} />
              </div>
            ))}
            <p className="pt-1 text-xs text-muted">
              知識不足が多いならインプット、読み違いやケアレスミスが多いなら演習量と解き方の見直しが効きます。
            </p>
          </Card>
        </section>
      )}

      {trend.length > 1 && (
        <section className="mb-6">
          <SectionTitle>正答率の推移</SectionTitle>
          <Card className="space-y-2">
            {trend.map((t, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted">{t.taken_on}</span>
                <Bar value={t.correct} max={t.total} label={`${Math.round(t.accuracy * 100)}%`} />
              </div>
            ))}
          </Card>
        </section>
      )}

      <section>
        <SectionTitle>学習時間の配分(直近30日)</SectionTitle>
        <Card className="space-y-3">
          <div>
            <div className="flex h-24 items-end gap-0.5">
              {daily.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date}: ${d.minutes}分`}
                  className={`flex-1 rounded-t ${d.minutes > 0 ? "bg-accent" : "bg-line"}`}
                  style={{ height: d.minutes > 0 ? `${Math.max((d.minutes / maxMinutes) * 100, 4)}%` : "2px" }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>{daily[0]?.date}</span>
              <span>最大 {maxMinutes}分/日</span>
              <span>{daily.at(-1)?.date}</span>
            </div>
          </div>
          <div className="space-y-1">
            {subjects
              .filter((s) => s.minutes > 0)
              .slice(0, 8)
              .map((s) => (
                <div key={s.subject} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 truncate text-xs">{s.subject}</span>
                  <Bar
                    value={s.minutes}
                    max={Math.max(...subjects.map((x) => x.minutes), 1)}
                    label={`${Math.round(s.minutes / 60)}h`}
                  />
                </div>
              ))}
          </div>
        </Card>
      </section>
    </>
  );
}
