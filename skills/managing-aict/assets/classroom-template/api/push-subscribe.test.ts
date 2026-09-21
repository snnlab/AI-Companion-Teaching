import { describe, it, expect, vi, beforeEach } from "vitest";

function streamOf(obj: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

const { put, get, del } = vi.hoisted(() => ({
  put: vi.fn(async (_pathname: string, _body: string, _options?: Record<string, unknown>) => ({})),
  get: vi.fn(),
  del: vi.fn(async (_pathname: string, _options?: Record<string, unknown>) => ({})),
}));
vi.mock("@vercel/blob", () => ({ put, get, del, list: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification: vi.fn(), generateVAPIDKeys: vi.fn() } }));

import { run } from "./push-subscribe";
import { hashToken } from "../lib/roster";

const PEPPER = "pepper";
const ENV = { BLOB_READ_WRITE_TOKEN: "blob-tok", ROSTER_TOKEN_PEPPER: PEPPER };
const TOKEN = "alice-token";
const TOKEN_HASH = hashToken(TOKEN, PEPPER);
const SUB = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

function authed() { return { authorization: `Bearer ${TOKEN}` }; }

beforeEach(() => {
  put.mockClear(); del.mockClear();
  get.mockImplementation(async (pathname: string) => {
    if (pathname === `roster-token-index/${TOKEN_HASH}.json`) {
      return { statusCode: 200, stream: streamOf({ studentId: "alice" }) };
    }
    if (pathname === "roster/alice.json") {
      return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: TOKEN_HASH, createdAt: "x" }) };
    }
    return null;
  });
});

describe("POST /api/push-subscribe", () => {
  it("rejects a request with no bearer token", async () => {
    const r = await run("POST", {}, SUB, ENV);
    expect(r.status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    get.mockResolvedValue(null);
    const r = await run("POST", { authorization: "Bearer nope" }, SUB, ENV);
    expect(r.status).toBe(401);
  });

  it("rejects a body that is not a push subscription", async () => {
    const r = await run("POST", authed(), { foo: "bar" }, ENV);
    expect(r).toEqual({ status: 400, json: { error: "not a valid push subscription" } });
  });

  it("stores a valid subscription for the resolved student", async () => {
    const r = await run("POST", authed(), SUB, ENV);
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(String(put.mock.calls[0]?.[0]).startsWith("push-sub/alice/")).toBe(true);
  });

  it("accepts a stringified JSON body", async () => {
    const r = await run("POST", authed(), JSON.stringify(SUB), ENV);
    expect(r.status).toBe(200);
  });
});

describe("DELETE /api/push-subscribe", () => {
  it("removes the subscription by endpoint", async () => {
    const r = await run("DELETE", authed(), { endpoint: SUB.endpoint }, ENV);
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("rejects a delete with no endpoint", async () => {
    const r = await run("DELETE", authed(), {}, ENV);
    expect(r.status).toBe(400);
  });
});

it("rejects other methods", async () => {
  const r = await run("GET", authed(), null, ENV);
  expect(r.status).toBe(405);
});
