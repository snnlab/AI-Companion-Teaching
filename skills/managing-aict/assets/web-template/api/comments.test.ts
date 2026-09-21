import { describe, it, expect, vi, beforeEach } from "vitest";

const store: Record<string, unknown> = {};
vi.mock("../lib/blobstore", () => ({
  putComment: vi.fn(async (_t: string, c: any) => {
    const existing = store[c.id] as any;
    if (!existing) {
      store[c.id] = c;
      return "created";
    }
    const withoutTime = ({ receivedAt: _receivedAt, ...value }: any) => value;
    return JSON.stringify(withoutTime(existing)) === JSON.stringify(withoutTime(c))
      ? "replay"
      : "conflict";
  }),
  listComments: vi.fn(async () => Object.values(store)),
}));

import { run } from "./comments";

const env = { BOARD_SESSION_SECRET: "sess", BOARD_PULL_KEY: "pull-1", BLOB_READ_WRITE_TOKEN: "tok" };
const now = 1_000_000;

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

const goodBody = {
  id: "11111111-1111-4111-8111-111111111111", clientId: "c1", author: "Ada",
  shareHash: "h1", annotation: { type: "doc-comment", view: "tracker", quote: "q", comment: "c" },
};

describe("POST /api/comments", () => {
  it("401 JSON without auth (never HTML)", async () => {
    const result = await run("POST", {}, goodBody, env, now);
    expect(result.status).toBe(401);
  });
  it("stores the first authed comment", async () => {
    const authHeaders = { "x-board-key": "pull-1" };
    expect((await run("POST", authHeaders, goodBody, env, now)).status).toBe(200);
    expect(Object.keys(store).length).toBe(1);
  });
  it("accepts an identical replay with one stored comment", async () => {
    const authHeaders = { "x-board-key": "pull-1" };
    expect((await run("POST", authHeaders, goodBody, env, now)).status).toBe(200);
    expect((await run("POST", authHeaders, goodBody, env, now)).status).toBe(200);
    expect(Object.keys(store).length).toBe(1);
  });
  it("returns 409 for conflicting id reuse and preserves the first comment", async () => {
    const authHeaders = { "x-board-key": "pull-1" };
    expect((await run("POST", authHeaders, goodBody, env, now)).status).toBe(200);
    const conflict = {
      ...goodBody,
      annotation: { ...goodBody.annotation, comment: "replacement" },
    };
    expect((await run("POST", authHeaders, conflict, env, now)).status).toBe(409);
    expect((store[goodBody.id] as any).annotation.comment).toBe("c");
  });
  it("accepts concurrent identical posts with one stored comment", async () => {
    const authHeaders = { "x-board-key": "pull-1" };
    const results = await Promise.all([
      run("POST", authHeaders, goodBody, env, now),
      run("POST", authHeaders, goodBody, env, now),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(Object.keys(store).length).toBe(1);
  });
  it("400 on invalid body", async () => {
    const bad = { ...goodBody, annotation: { type: "verdict" } };
    const result = await run("POST", { "x-board-key": "pull-1" }, bad, env, now);
    expect(result.status).toBe(400);
  });
});

describe("GET /api/comments", () => {
  it("401 JSON without auth", async () => {
    const result = await run("GET", {}, undefined, env, now);
    expect(result.status).toBe(401);
  });
  it("returns stored comments to an authed reader, no blob urls", async () => {
    await run("POST", { "x-board-key": "pull-1" }, goodBody, env, now);
    const result = await run("GET", { "x-board-key": "pull-1" }, undefined, env, now);
    expect(result.status).toBe(200);
    expect((result.json as { comments: unknown[] }).comments.length).toBe(1);
    expect(JSON.stringify(result)).not.toContain("blob.vercel-storage.com");
  });
});
