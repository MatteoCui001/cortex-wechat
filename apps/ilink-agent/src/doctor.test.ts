import { describe, expect, it } from "bun:test";
import { doctor } from "./doctor";

describe("doctor", () => {
  it("returns structured check results", async () => {
    const result = await doctor();
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("checks");

    // Should have these check keys
    expect(result.checks).toHaveProperty("cortex_api");
    expect(result.checks).toHaveProperty("ilink_account");
    expect(result.checks).toHaveProperty("state_dir");

    // Each check has pass and detail
    for (const check of Object.values(result.checks)) {
      expect(typeof check.pass).toBe("boolean");
      expect(typeof check.detail).toBe("string");
    }
  });

  it("state_dir check passes (writable)", async () => {
    const result = await doctor();
    expect(result.checks.state_dir.pass).toBe(true);
  });

  it("cortex_api check fails when no server running", async () => {
    // In test env, no Cortex server is running
    const result = await doctor();
    expect(result.checks.cortex_api.pass).toBe(false);
  });
});
