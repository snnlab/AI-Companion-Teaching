import { describe, it, expect, vi, beforeEach } from "vitest";

function streamOf(obj: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

const { put, get, list, del } = vi.hoisted(() => ({
  put: vi.fn(async (_pathname: string, _body: string, _options?: Record<string, unknown>) => ({})),
  get: vi.fn(),
  list: vi.fn(),
  del: vi.fn(async (_pathname: string, _options?: Record<string, unknown>) => ({})),
}));
vi.mock("@vercel/blob", () => ({ put, get, list, del }));
vi.mock("web-push", () => ({ default: { sendNotification: vi.fn(), generateVAPIDKeys: vi.fn() } }));

import {
  readVapid,
  isPushSubscription,
  putSub,
  listSubs,
  deleteSubByEndpoint,
  sendToStudent,
} from "./push";

const SUB = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

beforeEach(() => { put.mockClear(); get.mockReset(); list.mockReset(); del.mockClear(); });

describe("readVapid", () => {
  it("returns null unless both keys are set", () => {
    expect(readVapid({})).toBeNull();
    expect(readVapid({ VAPID_PUBLIC_KEY: "x" })).toBeNull();
    expect(readVapid({ VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "y" })).toMatchObject({ publicKey: "x", privateKey: "y" });
  });
  it("derives subject from the deploy URL when VAPID_SUBJECT is unset", () => {
    const v = readVapid({ VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "y", VERCEL_PROJECT_PRODUCTION_URL: "roster.vercel.app" });
    expect(v?.subject).toBe("https://roster.vercel.app");
  });
});

describe("isPushSubscription", () => {
  it("accepts a well-formed subscription", () => {
    expect(isPushSubscription(SUB)).toBe(true);
  });
  it("rejects junk", () => {
    expect(isPushSubscription(null)).toBe(false);
    expect(isPushSubscription({ endpoint: "http://insecure/x", keys: { p256dh: "p", auth: "a" } })).toBe(false);
    expect(isPushSubscription({ endpoint: "https://push/x" })).toBe(false);
  });
});

describe("putSub / listSubs", () => {
  it("writes one overwritable blob under push-sub/<studentId>/", async () => {
    await putSub("tok", "alice", SUB);
    const call = put.mock.calls[0];
    expect(String(call[0]).startsWith("push-sub/alice/")).toBe(true);
    expect(call[2]?.allowOverwrite).toBe(true);
  });

  it("lists and parses valid subscriptions, skipping corrupt ones", async () => {
    list.mockResolvedValue({ blobs: [{ pathname: "push-sub/alice/h1.json" }, { pathname: "push-sub/alice/h2.json" }], hasMore: false });
    get.mockImplementation(async (p: string) => {
      if (p === "push-sub/alice/h1.json") return { statusCode: 200, stream: streamOf(SUB) };
      return { statusCode: 200, stream: streamOf({ garbage: true }) };
    });
    const subs = await listSubs("tok", "alice");
    expect(subs).toEqual([SUB]);
  });
});

describe("sendToStudent", () => {
  const vapid = { publicKey: "x", privateKey: "y", subject: "https://s" };

  it("sends to every subscription and counts them", async () => {
    const send = vi.fn(async () => 201);
    const res = await sendToStudent("tok", "alice", vapid, { title: "t", body: "b", url: "/me" }, {
      listSubs: async () => [SUB, { ...SUB, endpoint: "https://push.example/def" }],
      deleteSubByEndpoint: async () => {},
      send,
    });
    expect(res).toEqual({ sent: 2, pruned: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("prunes a subscription the push service reports gone (410)", async () => {
    const deleteSubByEndpoint = vi.fn(async () => {});
    const res = await sendToStudent("tok", "alice", vapid, { title: "t", body: "b", url: "/me" }, {
      listSubs: async () => [SUB],
      deleteSubByEndpoint,
      send: async () => { throw Object.assign(new Error("gone"), { statusCode: 410 }); },
    });
    expect(res).toEqual({ sent: 0, pruned: 1 });
    expect(deleteSubByEndpoint).toHaveBeenCalledWith("tok", "alice", SUB.endpoint);
  });

  it("never throws when a send fails for another reason", async () => {
    const res = await sendToStudent("tok", "alice", vapid, { title: "t", body: "b", url: "/me" }, {
      listSubs: async () => [SUB],
      deleteSubByEndpoint: async () => {},
      send: async () => { throw new Error("network"); },
    });
    expect(res).toEqual({ sent: 0, pruned: 0 });
  });
});

describe("deleteSubByEndpoint", () => {
  it("swallows a delete of an already-gone blob", async () => {
    del.mockRejectedValueOnce(new Error("not found"));
    await expect(deleteSubByEndpoint("tok", "alice", SUB.endpoint)).resolves.toBeUndefined();
  });
});
