import { describe, expect, it } from "vitest";
import { sha256, sha256Json, stableStringify } from "@/lib/hash";

describe("stable JSON hashing", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(stableStringify({ z: 1, nested: { b: 2, a: 1 }, a: [2, 1] })).toBe(
      '{"a":[2,1],"nested":{"a":1,"b":2},"z":1}',
    );
  });

  it("produces the same digest for objects with different key order", () => {
    expect(sha256Json({ b: 2, a: 1 })).toBe(sha256Json({ a: 1, b: 2 }));
    expect(sha256("privacy")).toMatch(/^[a-f0-9]{64}$/);
  });
});
