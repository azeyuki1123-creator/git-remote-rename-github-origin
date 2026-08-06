import fs from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR } from "@/lib/db";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function GET(_req: Request, { params }: RouteContext<"/api/image/[name]">) {
  const { name } = await params;
  // 保存時に付けた UUID + 拡張子の形以外は受け付けない(パストラバーサル対策)
  if (!/^[0-9a-f-]{36}\.(jpg|png|gif|webp)$/.test(name)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const data = await fs.readFile(path.join(UPLOAD_DIR, name));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": TYPES[path.extname(name)],
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
