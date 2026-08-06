import Anthropic from "@anthropic-ai/sdk";
import { CAUSES, SOURCES, SUBJECT_NAMES, SUBJECTS } from "./subjects";

export type Analysis = {
  subject: string;
  field: string;
  source: string;
  source_detail: string;
  question_summary: string;
  correct_point: string;
  cause: string;
  key_points: string[];
};

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", enum: [...SUBJECT_NAMES] },
    field: { type: "string" },
    source: { type: "string", enum: [...SOURCES] },
    source_detail: { type: "string" },
    question_summary: { type: "string" },
    correct_point: { type: "string" },
    cause: { type: "string", enum: [...CAUSES] },
    key_points: { type: "array", items: { type: "string" } },
  },
  required: ["subject", "field", "source", "source_detail", "question_summary", "correct_point", "cause", "key_points"],
  additionalProperties: false,
} as const;

const SUBJECT_GUIDE = SUBJECTS.map((s) => `- ${s.name} (${s.slot}): ${s.fields.join(" / ")}`).join("\n");

const SYSTEM = `あなたは司法書士試験の指導経験が豊富な講師です。受験生が間違えた問題の写真を読み取り、後で傾向分析できる形に構造化します。

科目と分野は次の一覧から必ず選んでください。分野は該当科目の一覧内の語をそのまま使います。
${SUBJECT_GUIDE}

出力の指針:
- question_summary: 何を問う問題かを1〜2文で。条文番号や制度名は省略しない。
- correct_point: 正解を導くために必要だった知識・判断を具体的に書く。「〜を覚える」ではなく「〜の場合は〜になる」という形で。
- cause: 受験生が間違えた原因として最も可能性が高いものを一覧から1つ選ぶ。
- key_points: 復習時に確認すべき論点を3〜5個。それぞれ独立して読めるように書く。
- source_detail: 写真から判別できる出典(「令和5年度 午前 第12問」など)。不明なら空文字。
- 写真から読み取れない項目は推測せず、最も一般的な値を選ぶ。`;

export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function analyzeImage(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
  hint: string,
): Promise<Analysis> {
  const client = new Anthropic();

  const response = await client.beta.messages.create({
    model: process.env.CLAUDE_MODEL ?? "claude-opus-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          {
            type: "text",
            text: hint
              ? `この問題を間違えました。受験生のメモ: ${hint}`
              : "この問題を間違えました。分析してください。",
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("画像の解析が拒否されました。別の写真を試してください。");
  }

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("解析結果が空でした。");

  return JSON.parse(text) as Analysis;
}
