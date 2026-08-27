import { describe, expect, it } from "vitest";
import { Auth } from "./auth.js";

describe("Auth", () => {
  it("uses timing-safe password verification", () => {
    const auth = new Auth("correct horse battery", "a-session-secret-that-is-long-enough");
    expect(auth.verifyPassword("correct horse battery")).toBe(true);
    expect(auth.verifyPassword("wrong horse battery")).toBe(false);
  });

  it("rejects weak deployment secrets", () => {
    expect(() => new Auth("short", "also-short")).toThrow();
  });
});
