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

import { hashToken, mintToken, upsertStudent, rotateToken, getStudent, resolveToken, listRoster, getLastViewed, setLastViewed } from "./roster";

const TOKEN = "tok-blob";
const PEPPER = "pepper-123";

beforeEach(() => {
  put.mockClear();
  get.mockReset();
  list.mockReset();
  del.mockClear();
});

describe("mintToken / hashToken", () => {
  it("mints high-entropy, unique tokens", () => {
    const a = mintToken();
    const b = mintToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
  it("hashToken is deterministic and pepper-sensitive", () => {
    expect(hashToken("t", PEPPER)).toBe(hashToken("t", PEPPER));
    expect(hashToken("t", PEPPER)).not.toBe(hashToken("t", "other-pepper"));
  });
});

describe("upsertStudent", () => {
  it("registers a new student, storing only the token hash", async () => {
    get.mockResolvedValue(null); // no existing entry
    const { token, entry, rotated } = await upsertStudent(TOKEN, PEPPER, "alice", "Alice A.");
    expect(rotated).toBe(false);
    expect(entry.tokenHash).toBe(hashToken(token, PEPPER));
    expect(entry.tokenHash).not.toBe(token);

    const rosterCall = put.mock.calls.find((c) => c[0] === "roster/alice.json");
    expect(rosterCall).toBeTruthy();
    const stored = JSON.parse(rosterCall![1] as string);
    expect(JSON.stringify(stored)).not.toContain(token); // plaintext token never persisted

    const indexCall = put.mock.calls.find((c) => c[0] === `roster-token-index/${entry.tokenHash}.json`);
    expect(indexCall).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
  });

  it("rotating an existing student deletes the old token-index entry", async () => {
    const oldHash = hashToken("old-token", PEPPER);
    get.mockResolvedValue({
      statusCode: 200,
      stream: streamOf({ studentId: "alice", displayName: "Alice A.", tokenHash: oldHash, createdAt: "2026-08-01T00:00:00.000Z" }),
    });
    const { entry } = await upsertStudent(TOKEN, PEPPER, "alice", "Alice A.");
    expect(entry.tokenHash).not.toBe(oldHash);
    expect(del).toHaveBeenCalledWith(`roster-token-index/${oldHash}.json`, { token: TOKEN });
  });

  it("rotateToken reuses the existing displayName and fails for an unknown student", async () => {
    get.mockResolvedValue(null);
    expect(await rotateToken(TOKEN, PEPPER, "ghost")).toBeNull();

    get.mockResolvedValue({
      statusCode: 200,
      stream: streamOf({ studentId: "alice", displayName: "Alice A.", tokenHash: "x", createdAt: "2026-08-01T00:00:00.000Z" }),
    });
    const result = await rotateToken(TOKEN, PEPPER, "alice");
    expect(result?.entry.displayName).toBe("Alice A.");
  });
});

describe("resolveToken", () => {
  it("resolves a valid token to its studentId via the reverse index", async () => {
    const token = "student-token";
    const tokenHash = hashToken(token, PEPPER);
    get.mockImplementation(async (pathname: string) => {
      if (pathname === `roster-token-index/${tokenHash}.json`) {
        return { statusCode: 200, stream: streamOf({ studentId: "alice" }) };
      }
      if (pathname === "roster/alice.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash, createdAt: "x" }) };
      }
      return null;
    });
    expect(await resolveToken(TOKEN, PEPPER, token)).toBe("alice");
  });

  it("returns null for an unknown token", async () => {
    get.mockResolvedValue(null);
    expect(await resolveToken(TOKEN, PEPPER, "bogus")).toBeNull();
  });

  it("refuses a stale index entry that disagrees with the roster entry's current hash", async () => {
    const token = "student-token";
    const tokenHash = hashToken(token, PEPPER);
    get.mockImplementation(async (pathname: string) => {
      if (pathname === `roster-token-index/${tokenHash}.json`) {
        return { statusCode: 200, stream: streamOf({ studentId: "alice" }) };
      }
      if (pathname === "roster/alice.json") {
        // Roster entry has since rotated to a DIFFERENT hash — index is stale.
        return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: "different-hash", createdAt: "x" }) };
      }
      return null;
    });
    expect(await resolveToken(TOKEN, PEPPER, token)).toBeNull();
  });
});

describe("listRoster / getStudent", () => {
  it("paginates across list() pages", async () => {
    list.mockResolvedValueOnce({ blobs: [{ pathname: "roster/alice.json" }], hasMore: true, cursor: "c1" });
    list.mockResolvedValueOnce({ blobs: [{ pathname: "roster/bob.json" }], hasMore: false });
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: "h1", createdAt: "x" }) };
      if (pathname === "roster/bob.json") return { statusCode: 200, stream: streamOf({ studentId: "bob", displayName: "Bob", tokenHash: "h2", createdAt: "x" }) };
      return null;
    });
    const roster = await listRoster(TOKEN);
    expect(roster.map((r) => r.studentId).sort()).toEqual(["alice", "bob"]);
  });

  it("getStudent returns null when absent", async () => {
    get.mockResolvedValue(null);
    expect(await getStudent(TOKEN, "ghost")).toBeNull();
  });
});

describe("getLastViewed / setLastViewed", () => {
  it("returns null when the instructor has never viewed the roster", async () => {
    get.mockResolvedValue(null);
    expect(await getLastViewed(TOKEN)).toBeNull();
  });

  it("writes an overwritable pointer and reads it back", async () => {
    await setLastViewed(TOKEN, "2026-08-25T01:00:00.000Z");
    expect(put).toHaveBeenCalledWith(
      "roster-meta/last-viewed.json",
      JSON.stringify({ timestamp: "2026-08-25T01:00:00.000Z" }),
      expect.objectContaining({ allowOverwrite: true }),
    );
    get.mockResolvedValue({ statusCode: 200, stream: streamOf({ timestamp: "2026-08-25T01:00:00.000Z" }) });
    expect(await getLastViewed(TOKEN)).toBe("2026-08-25T01:00:00.000Z");
  });
});
