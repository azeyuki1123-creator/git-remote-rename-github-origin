import { json } from '../http.js';
import { branches } from '../stamps.js';
import { verifySignature, handleWebhookEvents } from '../line.js';

/**
 * LINE 公式アカウントの Webhook 受け口。
 * 生徒が連携コード（6 桁）を送ってくると、その生徒に line_user_id を紐づける。
 *
 * 署名は「LINE 連携が有効な支部」のチャネルシークレットで検証する。
 * どの支部の署名とも一致しなければ 401 を返す。
 */
export function register(router) {
  router.post('/line/webhook', (ctx) => {
    const raw = ctx.raw ?? '';
    const signature = ctx.req.headers['x-line-signature'];
    const enabled = branches().filter((b) => b.line_enabled && b.line_secret);

    if (!enabled.length) return json(ctx.res, { ok: false, reason: 'LINE 連携が有効な支部がありません' }, 503);
    const branch = enabled.find((b) => verifySignature(b.line_secret, raw, signature));
    if (!branch) return json(ctx.res, { ok: false, reason: '署名が一致しません' }, 401);

    let payload;
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      return json(ctx.res, { ok: false, reason: 'JSON を解析できません' }, 400);
    }

    const results = handleWebhookEvents(payload.events);
    json(ctx.res, { ok: true, branch: branch.name, linked: results.filter((r) => r.linked).length });
  });
}
