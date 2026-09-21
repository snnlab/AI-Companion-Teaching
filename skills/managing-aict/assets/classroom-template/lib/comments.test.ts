import { describe, it, expect, vi, beforeEach } from "vitest";

function streamOf(obj: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

const { put, get, list } = vi.hoisted(() => ({
  put: vi.fn(async (_pathname: string, _body: string, _options?: Record<string, unknown>) => ({})),
  get: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({ put, get, list }));

import { putComment, listCommentsForShareHash, type StoredComment } from "./comments";

const TOKEN = "tok-blob";

beforeEach(() => {
  put.mockReset();
  put.mockImplementation(async () => ({}));
  get.mockReset();
  list.mockReset();
});

function comment(overrides: Partial<StoredComment> = {}): StoredComment {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    clientId: "client-1",
    author: "instructor",
    shareHash: "cae78817221bfe49",
    docHash: null,
    annotation: { type: "general", comment: "worth a second look" },
    receivedAt: "2026-08-25T01:10:00.000Z",
    ...overrides,
  };
}

describe("putComment", () => {
  it("creates a new comment scoped under its shareHash", async () => {
    get.mockResolvedValue(null);
    const c = comment();
    const result = await putComment(TOKEN, c);
    expect(result).toBe("created");
    expect(put).toHaveBeenCalledTimes(1);
    const [pathname, , options] = put.mock.calls[0];
    expect(pathname).toBe(`comments/${c.shareHash}/${c.id}.json`);
    expect(options).toMatchObject({ access: "private", allowOverwrite: false, token: TOKEN });
  });

  it("treats an identical resend as a replay", async () => {
    const original = comment();
    get.mockResolvedValue({ statusCode: 200, stream: streamOf(original) });
    const resend = comment({ receivedAt: "2026-08-25T02:00:00.000Z" }); // ignored in the comparison
    const result = await putComment(TOKEN, resend);
    expect(result).toBe("replay");
    expect(put).not.toHaveBeenCalled();
  });

  it("flags a conflict when the same id carries different content", async () => {
    const original = comment();
    get.mockResolvedValue({ statusCode: 200, stream: streamOf(original) });
    const different = comment({ annotation: { type: "general", comment: "a different comment" } });
    const result = await putComment(TOKEN, different);
    expect(result).toBe("conflict");
    expect(put).not.toHaveBeenCalled();
  });
});

describe("listCommentsForShareHash", () => {
  it("lists only comments under the given shareHash prefix", async () => {
    list.mockImplementation(async ({ prefix }: { prefix: string }) => {
      expect(prefix).toBe("comments/cae78817221bfe49/");
      return {
        blobs: [{ pathname: "comments/cae78817221bfe49/11111111-1111-4111-8111-111111111111.json" }],
        hasMore: false,
      };
    });
    get.mockResolvedValue({ statusCode: 200, stream: streamOf(comment()) });
    const comments = await listCommentsForShareHash(TOKEN, "cae78817221bfe49");
    expect(comments).toHaveLength(1);
    expect(comments[0].shareHash).toBe("cae78817221bfe49");
  });

  it("skips corrupt blobs rather than throwing", async () => {
    list.mockResolvedValue({ blobs: [{ pathname: "comments/x/bad.json" }], hasMore: false });
    get.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("not json")); c.close(); } }),
    });
    expect(await listCommentsForShareHash(TOKEN, "x")).toEqual([]);
  });
});
