import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";

export interface DecoderInput { subject: string; sequence: number; timestamp: string; headers: Record<string, string[]>; payload: { utf8: string; base64: string } }

export class DecoderSandbox {
  async run(script: string, input: DecoderInput, timeoutMs = 50): Promise<unknown> {
    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(8 * 1024 * 1024);
    runtime.setMaxStackSize(256 * 1024);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));
    const context = runtime.newContext();
    try {
      const json = context.newString(JSON.stringify(input));
      context.setProp(context.global, "__NJV_INPUT", json);
      json.dispose();
      const wrapped = `"use strict";\n${script}\nif (typeof decode !== "function") throw new Error("Script must define function decode(input)");\nJSON.stringify(decode(JSON.parse(__NJV_INPUT)));`;
      const result = context.evalCode(wrapped, "decoder.js");
      if (result.error) {
        const detail = context.dump(result.error);
        result.error.dispose();
        throw new Error(typeof detail === "object" && detail && "message" in detail ? String(detail.message) : String(detail));
      }
      const value = context.dump(result.value);
      result.value.dispose();
      if (typeof value !== "string") throw new Error("Decoder result must be JSON-serializable");
      if (Buffer.byteLength(value) > 1_000_000) throw new Error("Decoder output exceeds 1 MB");
      return JSON.parse(value);
    } finally {
      context.dispose();
      runtime.dispose();
    }
  }
}
