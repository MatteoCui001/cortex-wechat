import { describe, expect, it } from "bun:test";
import { doctor } from "./doctor";

describe("doctor", () => {
  it("returns an array of named checks", async () => {
    const result = await doctor();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(6);

    const names = new Set(result.map((check) => check.name));
    expect(names.has("Environment")).toBe(true);
    expect(names.has("PostgreSQL")).toBe(true);
    expect(names.has("Cortex API")).toBe(true);
    expect(names.has("LLM Config")).toBe(true);
    expect(names.has("WeChat Session")).toBe(true);
    expect(names.has("Disk Space")).toBe(true);
  });

  it("uses the current CheckResult contract", async () => {
    const result = await doctor();

    for (const check of result) {
      expect(typeof check.name).toBe("string");
      expect(["ok", "warn", "fail"]).toContain(check.status);
      expect(typeof check.detail).toBe("string");
    }
  });
});
