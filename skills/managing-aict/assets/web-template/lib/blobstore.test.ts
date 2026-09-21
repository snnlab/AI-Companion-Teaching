import { describe, it, expect, vi, beforeEach } from "vitest";

function streamOf(obj: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

const { put, list, get } = vi.hoisted(() => ({
  put: vi.fn(async (_pathname: string, _body: string, _options: Record<string, unknown>) => ({})),
  list: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ put, list, get }));

import { putComment, listComments, type StoredComment } from "./blobstore";

const TOKEN = "test-token";

beforeEach(() => {
  put.mockClear();
  list.mockReset();
  get.mockReset();
});

const comment1: StoredComment = {
  id: "11111111-1111-4111-8111-111111111111", clientId: "c1", author: "Ada",
  shareHash: "h1", docHash: null,
  annotation: { type: "doc-comment", comment: "same" }, receivedAt: "2026-01-01T00:00:00.000Z",
};
const comment2: StoredComment = {
  id: "22222222-2222-4222-8222-222222222222", clientId: "c2", author: "Grace",
  shareHash: "h2", docHash: null,
  annotation: { type: "doc-comment" }, receivedAt: "2026-01-02T00:00:00.000Z",
};

describe("listComments", () => {
  it("returns the parsed content of stored comments, with no blob-descriptor fields leaked", async () => {
    list.mockResolvedValue({
      blobs: [{ pathname: "comments/1.json", url: "https://private.blob.vercel-storage.com/comments/1.json" }],
      hasMore: false,
    });
    get.mockResolvedValue({ statusCode: 200, stream: streamOf(comment1) });

    const out = await listComments(TOKEN);

    expect(out.length).toBe(1);
    expect(out[0].author).toBe("Ada");
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("url");
    expect(serialized).not.toContain("downloadUrl");
    expect(serialized).not.toContain("pathname");
    expect(serialized).not.toContain("blob.vercel-storage.com");
  });

  it("paginates across multiple list() pages", async () => {
    list.mockResolvedValueOnce({
      blobs: [{ pathname: "comments/1.json", url: "https://private.blob.vercel-storage.com/comments/1.json" }],
      hasMore: true,
      cursor: "c1",
    });
    list.mockResolvedValueOnce({
      blobs: [{ pathname: "comments/2.json", url: "https://private.blob.vercel-storage.com/comments/2.json" }],
      hasMore: false,
    });
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "comments/1.json") return { statusCode: 200, stream: streamOf(comment1) };
      if (pathname === "comments/2.json") return { statusCode: 200, stream: streamOf(comment2) };
      throw new Error(`unexpected pathname ${pathname}`);
    });

    const out = await listComments(TOKEN);

    expect(list).toHaveBeenCalledTimes(2);
    expect(out.length).toBe(2);
    expect(out.map((c) => c.author).sort()).toEqual(["Ada", "Grace"]);
  });
});

describe("putComment", () => {
  it("creates a private comment without allowing overwrite", async () => {
    get.mockResolvedValue(null);
    await expect(putComment(TOKEN, comment1)).resolves.toBe("created");

    expect(put).toHaveBeenCalledTimes(1);
    const [pathname, body, options] = put.mock.calls[0];
    expect(pathname).toBe(`comments/${comment1.id}.json`);
    expect(JSON.parse(body as string)).toEqual(comment1);
    expect(options).toMatchObject({ access: "private", allowOverwrite: false, token: TOKEN });
  });

  it("accepts an identical replay without rewriting the stored comment", async () => {
    get.mockResolvedValue({ statusCode: 200, stream: streamOf(comment1) });
    const replay = {
      ...comment1,
      annotation: { comment: "same", type: "doc-comment" },
      receivedAt: "2026-01-03T00:00:00.000Z",
    };

    await expect(putComment(TOKEN, replay)).resolves.toBe("replay");
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects conflicting reuse without modifying the stored comment", async () => {
    get.mockResolvedValue({ statusCode: 200, stream: streamOf(comment1) });
    const conflict = { ...comment1, author: "Mallory" };

    await expect(putComment(TOKEN, conflict)).resolves.toBe("conflict");
    expect(put).not.toHaveBeenCalled();
  });

  it("resolves concurrent identical creates as one create and one replay", async () => {
    let stored: StoredComment | null = null;
    get.mockImplementation(async () => (
      stored ? { statusCode: 200, stream: streamOf(stored) } : null
    ));
    put.mockImplementation(async (_pathname: string, body: string) => {
      if (stored) throw new Error("pathname already exists");
      stored = JSON.parse(body) as StoredComment;
      return {};
    });

    const results = await Promise.all([
      putComment(TOKEN, comment1),
      putComment(TOKEN, { ...comment1, receivedAt: "2026-01-03T00:00:00.000Z" }),
    ]);

    expect(results.sort()).toEqual(["created", "replay"]);
    expect(put).toHaveBeenCalledTimes(2);
    expect(stored).toEqual(comment1);
  });
});
