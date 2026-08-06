import Link from "next/link";
import { archiveMistake, reviewMistake } from "@/app/actions";
import { SubjectFilter } from "@/components/SubjectFilter";
import { Card, Empty, PageTitle, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { SUBJECT_NAMES } from "@/lib/subjects";
import { type Mistake, keyPoints } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNDERSTANDING = ["まだ危うい", "うろ覚え", "だいたい分かる", "完全に理解"];

function query(subject: string, filter: string) {
  const where = ["archived = 0"];
  const args: string[] = [];
  if (subject && SUBJECT_NAMES.includes(subject)) {
    where.push("subject = ?");
    args.push(subject);
  }
  if (filter === "due") where.push("next_review_on IS NOT NULL AND next_review_on <= date('now')");
  if (filter === "weak") where.push("understanding <= 1");
  return db
    .prepare(`SELECT * FROM mistakes WHERE ${where.join(" AND ")} ORDER BY studied_on DESC, id DESC LIMIT 200`)
    .all(...args) as Mistake[];
}

export default async function MistakesPage({ searchParams }: PageProps<"/mistakes">) {
  const sp = await searchParams;
  const subject = typeof sp.subject === "string" ? sp.subject : "";
  const filter = typeof sp.filter === "string" ? sp.filter : "";
  const items = query(subject, filter);

  const tabs = [
    { key: "", label: "すべて" },
    { key: "due", label: "復習日が来た" },
    { key: "weak", label: "理解が浅い" },
  ];

  return (
    <>
      <PageTitle title="苦手ノート" sub={`${items.length}件`} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={{ pathname: "/mistakes", query: { ...(subject && { subject }), ...(t.key && { filter: t.key }) } }}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              filter === t.key ? "border-accent text-accent" : "border-line text-muted"
            }`}
          >
            {t.label}
          </Link>
        ))}
        <div className="ml-auto w-48">
          <SubjectFilter value={subject} basePath="/mistakes" extra={filter ? { filter } : {}} />
        </div>
      </div>

      {items.length === 0 ? (
        <Empty>
          まだ記録がありません。<Link href="/mistakes/new" className="text-accent underline">写真を送って記録する</Link>
        </Empty>
      ) : (
        <ul className="space-y-3">
          {items.map((m) => (
            <li key={m.id}>
              <Card className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-md bg-accent/10 px-2 py-0.5 font-medium text-accent">{m.subject}</span>
                  {m.field && <Tag>{m.field}</Tag>}
                  <Tag>{m.source}</Tag>
                  {m.source_detail && <span className="text-muted">{m.source_detail}</span>}
                  <span className="ml-auto text-muted">{m.studied_on}</span>
                </div>

                {m.question_summary && <p className="text-sm">{m.question_summary}</p>}
                {m.correct_point && (
                  <p className="rounded-lg bg-background p-3 text-sm">
                    <span className="font-medium">押さえる点：</span>
                    {m.correct_point}
                  </p>
                )}
                {keyPoints(m).length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                    {keyPoints(m).map((k, i) => (
                      <li key={i}>{k}</li>
                    ))}
                  </ul>
                )}
                {m.cause && <p className="text-xs text-muted">原因：{m.cause}</p>}
                {m.memo && <p className="text-sm text-muted">メモ：{m.memo}</p>}

                {m.image_path && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/image/${m.image_path}`}
                    alt="問題の写真"
                    className="max-h-80 w-full rounded-lg object-contain"
                  />
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <span className="text-xs text-muted">
                    {m.review_count > 0 ? `${m.review_count}回復習 / ${UNDERSTANDING[m.understanding]}` : "未復習"}
                    {m.next_review_on && ` ・次回 ${m.next_review_on}`}
                  </span>
                  <form action={reviewMistake} className="ml-auto flex items-center gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    {UNDERSTANDING.map((label, level) => (
                      <button
                        key={level}
                        type="submit"
                        name="understanding"
                        value={level}
                        className="rounded-md border border-line px-2 py-1 text-xs hover:bg-background"
                      >
                        {label}
                      </button>
                    ))}
                  </form>
                  <form action={archiveMistake}>
                    <input type="hidden" name="id" value={m.id} />
                    <button type="submit" className="rounded-md px-2 py-1 text-xs text-muted hover:underline">
                      克服した
                    </button>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
