"use client";

import { useRouter } from "next/navigation";
import { SUBJECT_NAMES } from "@/lib/subjects";

export function SubjectFilter({ value, basePath, extra = {} }: { value: string; basePath: string; extra?: Record<string, string> }) {
  const router = useRouter();
  return (
    <select
      aria-label="科目で絞り込む"
      value={value}
      onChange={(e) => {
        const params = new URLSearchParams(extra);
        if (e.target.value) params.set("subject", e.target.value);
        const q = params.toString();
        router.push(q ? `${basePath}?${q}` : basePath);
      }}
    >
      <option value="">全科目</option>
      {SUBJECT_NAMES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
