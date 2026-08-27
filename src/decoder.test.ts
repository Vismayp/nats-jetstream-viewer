import { describe, expect, it } from "vitest";
import { DecoderSandbox, type DecoderInput } from "./decoder.js";

const input: DecoderInput = {
  subject: "jobs.email", sequence: 7, timestamp: "2026-08-27T00:00:00.000Z",
  headers: { "Content-Type": ["application/json"] },
  payload: { utf8: '{"recipient":"user@example.com"}', base64: "" },
};

describe("DecoderSandbox", () => {
  it("decodes JSON in an isolated runtime", async () => {
    const output = await new DecoderSandbox().run("function decode(input) { return { ...JSON.parse(input.payload.utf8), seq: input.sequence }; }", input);
    expect(output).toEqual({ recipient: "user@example.com", seq: 7 });
  });

  it("does not expose Node globals", async () => {
    const output = await new DecoderSandbox().run("function decode() { return { process: typeof process, require: typeof require, fetch: typeof fetch }; }", input);
    expect(output).toEqual({ process: "undefined", require: "undefined", fetch: "undefined" });
  });

  it("interrupts runaway scripts", async () => {
    await expect(new DecoderSandbox().run("function decode() { while (true) {} }", input, 10)).rejects.toThrow();
  });
});
