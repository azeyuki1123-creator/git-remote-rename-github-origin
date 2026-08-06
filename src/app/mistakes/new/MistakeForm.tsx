"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createMistake } from "@/app/actions";
import { Card } from "@/components/ui";
import { CAUSES, SOURCES, SUBJECTS, fieldsOf } from "@/lib/subjects";

function Submit({ aiOn }: { aiOn: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-white disabled:opacity-60"
    >
      {pending ? (aiOn ? "AIが解析しています…" : "保存中…") : "保存する"}
    </button>
  );
}

export function MistakeForm({ aiAvailable }: { aiAvailable: boolean }) {
  const [subject, setSubject] = useState("");
  const [useAi, setUseAi] = useState(aiAvailable);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <form action={createMistake} className="space-y-4">
      <Card className="space-y-3">
        <div>
          <label htmlFor="image">問題の写真</label>
          <input
            id="image"
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
          />
        </div>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="選択した写真" className="max-h-72 w-full rounded-lg object-contain" />
        )}

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="use_ai"
            checked={useAi}
            disabled={!aiAvailable}
            onChange={(e) => setUseAi(e.target.checked)}
            className="h-4 w-4 w-auto"
          />
          写真をAIに解析させる(科目・分野・論点を自動で埋める)
        </label>
        {!aiAvailable && (
          <p className="text-xs text-muted">
            ANTHROPIC_API_KEY が未設定のため、AI解析は使えません。手入力で記録できます。
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <p className="text-sm text-muted">
          {useAi ? "AIが埋めるので空欄でOK。指定した項目はAIの結果より優先されます。" : "科目は必須です。"}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="subject">科目</label>
            <select id="subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">{useAi ? "AIにまかせる" : "選択してください"}</option>
              {SUBJECTS.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.slot}｜{s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="field">分野</label>
            <select id="field" name="field" disabled={!subject}>
              <option value="">{subject ? "指定しない" : "先に科目を選ぶ"}</option>
              {fieldsOf(subject).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="source">出典</label>
            <select id="source" name="source" defaultValue="">
              <option value="">{useAi ? "AIにまかせる" : "その他"}</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="source_detail">出典の詳細</label>
            <input id="source_detail" name="source_detail" placeholder="令和5年度 午前 第12問" />
          </div>
          <div>
            <label htmlFor="cause">間違えた原因</label>
            <select id="cause" name="cause" defaultValue="">
              <option value="">{useAi ? "AIにまかせる" : "指定しない"}</option>
              {CAUSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="studied_on">学習日</label>
            <input id="studied_on" name="studied_on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
        </div>
        <div>
          <label htmlFor="memo">メモ</label>
          <textarea id="memo" name="memo" rows={3} placeholder="なぜ間違えたか、どこで迷ったか" />
        </div>
      </Card>

      <Submit aiOn={useAi} />
    </form>
  );
}
