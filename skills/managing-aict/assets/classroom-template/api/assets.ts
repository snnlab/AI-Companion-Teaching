// /api/assets — files a submission carries outside its JSON envelope (see
// lib/assets.ts for why and how they are trusted).
//
//   POST ?op=check                       bearer   {assets:[{sha,parts}]} -> {missing:[sha]}
//   POST ?op=put&sha=&part=&parts=[&partSha=]   bearer   raw bytes of one part
//   GET  ?student=&sha=&part=             instructor session   raw bytes of one part
//
// Every request and response stays under the 4.5 MB Vercel Function body cap
// by construction: a part is at most ASSET_PART_BYTES (4 MB).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthed, type HeaderBag } from "../lib/auth.js";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { resolveToken, STUDENT_ID_RE } from "../lib/roster.js";
import {
  ASSET_PART_BYTES,
  MAX_ASSET_PARTS,
  SHA256_RE,
  hasAsset,
  isRecord,
  putAssetPart,
  readAssetPart,
  sha256Hex,
} from "../lib/assets.js";

export interface RunResult {
  status: number;
  json?: unknown;
  bytes?: Buffer;
}

type Query = Record<string, string | string[] | undefined>;

function q(query: Query, key: string): string | null {
  const v = query[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.length > 0 ? s : null;
}

function intParam(query: Query, key: string): number | null {
  const s = q(query, key);
  if (s === null || !/^\d{1,4}$/.test(s)) return null;
  return Number(s);
}

function bearerToken(headers: HeaderBag): string | null {
  const raw = headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function run(
  method: string,
  headers: HeaderBag,
  query: Query,
  body: Buffer,
  env: Record<string, string | undefined>,
  now: number,
): Promise<RunResult> {
  const blobToken = env.BLOB_READ_WRITE_TOKEN as string;

  if (method === "GET") {
    if (!isAuthed({ BOARD_SESSION_SECRET: env.BOARD_SESSION_SECRET }, headers, now)) {
      return { status: 401, json: { error: "unauthorized" } };
    }
    const studentId = q(query, "student");
    const sha = q(query, "sha");
    const part = intParam(query, "part");
    if (!studentId || !STUDENT_ID_RE.test(studentId) || !sha || !SHA256_RE.test(sha) || part === null) {
      return { status: 400, json: { error: "bad_request" } };
    }
    const bytes = await readAssetPart(blobToken, studentId, sha, part);
    if (!bytes) return { status: 404, json: { error: "not_found" } };
    return { status: 200, bytes };
  }

  if (method !== "POST") return { status: 405, json: { error: "method not allowed" } };

  const token = bearerToken(headers);
  if (!token) return { status: 401, json: { error: "invalid_token" } };
  const studentId = await resolveToken(blobToken, env.ROSTER_TOKEN_PEPPER ?? "", token);
  if (!studentId) return { status: 401, json: { error: "invalid_token" } };

  const op = q(query, "op");
  if (op === "check") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      return { status: 400, json: { error: "bad json" } };
    }
    const list = isRecord(parsed) && Array.isArray(parsed.assets) ? parsed.assets : null;
    if (!list || list.length > 500) return { status: 400, json: { error: "assets must be an array (max 500)" } };
    const missing: string[] = [];
    for (const a of list) {
      if (!isRecord(a) || typeof a.sha !== "string" || !SHA256_RE.test(a.sha)) {
        return { status: 400, json: { error: "each asset needs a sha256" } };
      }
      const parts = typeof a.parts === "number" && Number.isInteger(a.parts) ? a.parts : 1;
      if (parts < 1 || parts > MAX_ASSET_PARTS) return { status: 400, json: { error: "parts out of range" } };
      if (!(await hasAsset(blobToken, studentId, a.sha, parts))) missing.push(a.sha);
    }
    return { status: 200, json: { missing } };
  }

  if (op === "put") {
    const sha = q(query, "sha");
    const part = intParam(query, "part");
    const parts = intParam(query, "parts");
    if (!sha || !SHA256_RE.test(sha) || part === null || parts === null || parts < 1 || parts > MAX_ASSET_PARTS || part >= parts) {
      return { status: 400, json: { error: "bad_request" } };
    }
    if (body.length === 0 || body.length > ASSET_PART_BYTES) {
      return { status: 413, json: { error: "part_too_large", limitBytes: ASSET_PART_BYTES } };
    }
    // Verify what actually arrived before storing it: a single-part file
    // against its full hash, a part of a larger file against the declared
    // per-part hash (the whole is re-checked when a submission references it).
    const expected = parts === 1 ? sha : q(query, "partSha");
    if (!expected || !SHA256_RE.test(expected) || sha256Hex(body) !== expected) {
      return { status: 400, json: { error: "hash_mismatch" } };
    }
    await putAssetPart(blobToken, studentId, sha, part, body);
    return { status: 200, json: { ok: true } };
  }

  return { status: 400, json: { error: "unknown op" } };
}

// Raw bytes in both directions, so no JSON body parser.
export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const b = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    total += b.length;
    if (total > ASSET_PART_BYTES + 1024) break; // run() rejects it with 413
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = req.method === "POST" ? await readRawBody(req) : Buffer.alloc(0);
  const r = await run(
    req.method ?? "GET",
    req.headers as HeaderBag,
    req.query as Query,
    body,
    process.env,
    Math.floor(Date.now() / 1000),
  );
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (r.bytes) {
    // Content-addressed and immutable: safe for the browser to keep.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Content-Type", "application/octet-stream");
    res.status(r.status).send(r.bytes);
    return;
  }
  res.status(r.status).json(r.json);
}
