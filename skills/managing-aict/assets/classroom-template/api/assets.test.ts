import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

function streamOf(obj: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}
function streamBytes(b: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.enqueue(new Uint8Array(b)); c.close(); } });
}

const store = new Map<string, Buffer>();
const { put, get, head } = vi.hoisted(() => ({
  put: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({ put, get, head }));

import { run } from "./assets";
import { signCookie } from "../lib/auth";
import { hashToken } from "../lib/roster";

const SECRET = "instructor-secret";
const NOW = 1_000_000;
const ENV = { BLOB_READ_WRITE_TOKEN: "blob-tok", BOARD_SESSION_SECRET: SECRET, ROSTER_TOKEN_PEPPER: "p" };
const BEARER = { authorization: "Bearer good-token" };
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

beforeEach(() => {
  store.clear();
  put.mockReset().mockImplementation(async (p: string, body: Buffer) => { store.set(p, Buffer.from(body)); return {}; });
  head.mockReset().mockImplementation(async (p: string) => {
    if (!store.has(p)) throw new Error("not found");
    return { pathname: p };
  });
  get.mockReset().mockImplementation(async (p: string) => {
    if (p.startsWith("roster-token-index/")) return { statusCode: 200, stream: streamOf({ studentId: "alice" }) };
    if (p === "roster/alice.json") {
      return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: hashToken("good-token", "p"), createdAt: "x" }) };
    }
    const b = store.get(p);
    return b ? { statusCode: 200, stream: streamBytes(b) } : null;
  });
});

describe("POST /api/assets?op=put", () => {
  it("rejects a request without a valid bearer token", async () => {
    expect((await run("POST", {}, { op: "put" }, Buffer.from("x"), ENV, NOW)).status).toBe(401);
    get.mockImplementation(async () => null);
    expect((await run("POST", BEARER, { op: "put" }, Buffer.from("x"), ENV, NOW)).status).toBe(401);
  });

  it("stores a single-part file only when its bytes hash to the declared sha", async () => {
    const bytes = Buffer.from("png-bytes");
    const ok = await run("POST", BEARER, { op: "put", sha: sha(bytes), part: "0", parts: "1" }, bytes, ENV, NOW);
    expect(ok).toEqual({ status: 200, json: { ok: true } });
    expect(store.has(`assets/alice/${sha(bytes)}/0`)).toBe(true);

    const wrong = await run("POST", BEARER, { op: "put", sha: sha(Buffer.from("other")), part: "0", parts: "1" }, bytes, ENV, NOW);
    expect(wrong).toEqual({ status: 400, json: { error: "hash_mismatch" } });
  });

  it("checks a multi-part part against its declared per-part hash", async () => {
    const part = Buffer.from("first-half");
    const whole = sha(Buffer.from("first-halfsecond-half"));
    const r = await run("POST", BEARER, { op: "put", sha: whole, part: "0", parts: "2", partSha: sha(part) }, part, ENV, NOW);
    expect(r.status).toBe(200);
    const bad = await run("POST", BEARER, { op: "put", sha: whole, part: "1", parts: "2", partSha: sha(part) }, Buffer.from("nope"), ENV, NOW);
    expect(bad.status).toBe(400);
  });

  it("rejects an out-of-range part index", async () => {
    const b = Buffer.from("x");
    const r = await run("POST", BEARER, { op: "put", sha: sha(b), part: "1", parts: "1" }, b, ENV, NOW);
    expect(r.status).toBe(400);
  });
});

describe("POST /api/assets?op=check", () => {
  it("reports which files are not yet stored for this student", async () => {
    const have = Buffer.from("have");
    store.set(`assets/alice/${sha(have)}/0`, have);
    const missingSha = sha(Buffer.from("missing"));
    const body = Buffer.from(JSON.stringify({ assets: [{ sha: sha(have), parts: 1 }, { sha: missingSha, parts: 1 }] }));
    const r = await run("POST", BEARER, { op: "check" }, body, ENV, NOW);
    expect(r).toEqual({ status: 200, json: { missing: [missingSha] } });
  });
});

describe("GET /api/assets", () => {
  it("lets a student read back only their OWN files with their token", async () => {
    const mine = Buffer.from("my-figure");
    const theirs = Buffer.from("bob-figure");
    store.set(`assets/alice/${sha(mine)}/0`, mine);
    store.set(`assets/bob/${sha(theirs)}/0`, theirs);
    const r = await run("GET", BEARER, { sha: sha(mine), part: "0" }, Buffer.alloc(0), ENV, NOW);
    expect(r.status).toBe(200);
    expect(r.bytes?.toString()).toBe("my-figure");
    // naming another student does not reach their files: the token's owner wins
    const other = await run("GET", BEARER, { student: "bob", sha: sha(theirs), part: "0" }, Buffer.alloc(0), ENV, NOW);
    expect(other.status).toBe(404);
    get.mockImplementation(async () => null); // unknown token
    expect((await run("GET", BEARER, { sha: sha(mine), part: "0" }, Buffer.alloc(0), ENV, NOW)).status).toBe(401);
  });

  it("serves the instructor any student's file", async () => {
    const b = Buffer.from("figure");
    store.set(`assets/alice/${sha(b)}/0`, b);
    const q = { student: "alice", sha: sha(b), part: "0" };
    expect((await run("GET", {}, q, Buffer.alloc(0), ENV, NOW)).status).toBe(401);
    const cookie = { cookie: `instructor_session=${signCookie(SECRET, NOW, 3600)}` };
    const r = await run("GET", cookie, q, Buffer.alloc(0), ENV, NOW);
    expect(r.status).toBe(200);
    expect(r.bytes?.toString()).toBe("figure");
    expect((await run("GET", cookie, { ...q, sha: sha(Buffer.from("nope")) }, Buffer.alloc(0), ENV, NOW)).status).toBe(404);
  });
});
