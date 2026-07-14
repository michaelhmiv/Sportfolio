import { describe, expect, it } from "vitest";
import {
  CollectionApiError,
  extractCollectionApiError,
  parseCollectionFetchError,
} from "./collection-api-error";

describe("CollectionApiError", () => {
  it("has correct properties", () => {
    const err = new CollectionApiError("Not found", "COLLECTION_NOT_FOUND", 404);
    expect(err.message).toBe("Not found");
    expect(err.code).toBe("COLLECTION_NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.name).toBe("CollectionApiError");
  });

  it("detects not-found", () => {
    const err = new CollectionApiError("Not found", "COLLECTION_NOT_FOUND", 404);
    expect(err.isNotFound).toBe(true);
    expect(err.isTransient).toBe(false);
  });

  it("detects transient errors", () => {
    const err500 = new CollectionApiError("Server error", "INTERNAL_ERROR", 500);
    expect(err500.isTransient).toBe(true);
    expect(err500.isNotFound).toBe(false);
  });

  it("non-404 4xx are transient", () => {
    const err = new CollectionApiError("Conflict", "CONFLICT", 409);
    expect(err.isTransient).toBe(true);
    expect(err.isNotFound).toBe(false);
  });
});

describe("extractCollectionApiError", () => {
  it("returns null for ok response", async () => {
    const res = new Response(JSON.stringify({ data: [] }), { status: 200 });
    const err = await extractCollectionApiError(res);
    expect(err).toBeNull();
  });

  it("extracts error from structured response", async () => {
    const res = new Response(
      JSON.stringify({
        error: { code: "COLLECTION_NOT_FOUND", message: "Not found", details: { slug: "x" } },
      }),
      { status: 404 },
    );
    const err = await extractCollectionApiError(res);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("COLLECTION_NOT_FOUND");
    expect(err!.status).toBe(404);
    expect(err!.details).toEqual({ slug: "x" });
  });

  it("returns null for unparseable response", async () => {
    const res = new Response("plain text", { status: 500 });
    const err = await extractCollectionApiError(res);
    expect(err).toBeNull();
  });
});

describe("parseCollectionFetchError", () => {
  it("returns existing CollectionApiError unchanged", () => {
    const orig = new CollectionApiError("msg", "CODE", 400);
    expect(parseCollectionFetchError(orig)).toBe(orig);
  });

  it("wraps Error instances", () => {
    const result = parseCollectionFetchError(new Error("boom"));
    expect(result).toBeInstanceOf(CollectionApiError);
    expect(result.message).toBe("boom");
    expect(result.code).toBe("FETCH_ERROR");
  });

  it("wraps unknown types with a standard fallback", () => {
    const result = parseCollectionFetchError("string error");
    expect(result).toBeInstanceOf(CollectionApiError);
    expect(result.code).toBe("FETCH_ERROR");
    // Non-Error values get a generic fallback message.
  });
});
