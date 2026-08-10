// リクエスト解析とレスポンス生成のヘルパー（フレームワーク非依存の薄い層）。
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { UPLOAD_DIR } from './db.js';

export const MAX_BODY_BYTES = 200 * 1024 * 1024; // 動画アップロードを想定して 200MB

/** HTML エスケープ。テンプレート内で必ず通す。 */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge = 60 * 60 * 24 * 14, path = '/' } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (maxAge !== null) parts.push(`Max-Age=${maxAge}`);
  if (process.env.SECURE_COOKIE === '1') parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
}

function collectBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('リクエストボディが大きすぎます'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * フォーム本文を解析して { fields, files } を返す。
 * application/x-www-form-urlencoded と multipart/form-data に対応。
 */
export async function parseBody(req) {
  const type = req.headers['content-type'] || '';
  if (type.startsWith('multipart/form-data')) {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type);
    if (!boundary) return { fields: {}, files: {} };
    const raw = await collectBody(req);
    return parseMultipart(raw, boundary[1] || boundary[2].trim());
  }
  const raw = await collectBody(req, 2 * 1024 * 1024);
  const fields = {};
  for (const [key, value] of new URLSearchParams(raw.toString('utf8'))) {
    addField(fields, key, value);
  }
  return { fields, files: {} };
}

/** 同名フィールド（チェックボックスなど）は配列にまとめる */
function addField(fields, name, value) {
  if (name in fields) {
    fields[name] = [].concat(fields[name], value);
  } else {
    fields[name] = value;
  }
}

/** multipart/form-data の最小実装。1ファイル程度の利用を想定。 */
export function parseMultipart(buffer, boundary) {
  const fields = {};
  const files = {};
  const delimiter = Buffer.from(`--${boundary}`);
  let position = buffer.indexOf(delimiter);
  if (position < 0) return { fields, files };
  position += delimiter.length;

  while (position < buffer.length) {
    if (buffer[position] === 0x2d && buffer[position + 1] === 0x2d) break; // 終端 "--"
    if (buffer[position] === 0x0d) position += 2; // CRLF
    const headerEnd = buffer.indexOf('\r\n\r\n', position, 'utf8');
    if (headerEnd < 0) break;
    const headerText = buffer.toString('utf8', position, headerEnd);
    const bodyStart = headerEnd + 4;
    let bodyEnd = buffer.indexOf(delimiter, bodyStart);
    if (bodyEnd < 0) bodyEnd = buffer.length;
    const content = buffer.subarray(bodyStart, Math.max(bodyStart, bodyEnd - 2)); // 末尾 CRLF を除く

    const nameMatch = /name="([^"]*)"/.exec(headerText);
    const fileMatch = /filename="([^"]*)"/.exec(headerText);
    const name = nameMatch ? nameMatch[1] : '';
    if (name) {
      if (fileMatch) {
        const contentType = /content-type:\s*([^\r\n]+)/i.exec(headerText);
        files[name] = {
          originalName: fileMatch[1],
          contentType: contentType ? contentType[1].trim() : 'application/octet-stream',
          size: content.length,
          data: content,
        };
      } else {
        addField(fields, name, content.toString('utf8'));
      }
    }
    position = bodyEnd + delimiter.length;
  }
  return { fields, files };
}

const SAFE_UPLOAD_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.jpg', '.jpeg', '.png', '.pdf']);

/** アップロードされたファイルを data/uploads に保存し、保存名を返す。 */
export async function saveUpload(file) {
  if (!file || !file.size) return '';
  const ext = extname(file.originalName || '').toLowerCase();
  if (!SAFE_UPLOAD_EXT.has(ext)) {
    throw new HttpError(400, `対応していない拡張子です（${ext || '不明'}）`);
  }
  const stored = `${randomUUID()}${ext}`;
  await writeFile(join(UPLOAD_DIR, stored), file.data);
  return stored;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function html(res, body, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  res.end(body);
}

export function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

export function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export { createWriteStream };
