/**
 * Doctor / preflight check — verifies all prerequisites before running.
 */
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { CortexClient } from "@cortex-wechat/core";

const STATE_DIR = join(homedir(), ".cortex", "wechat");
const ACCOUNT_PATH = join(STATE_DIR, "account.json");

export interface DoctorResult {
  ok: boolean;
  checks: Record<string, { pass: boolean; detail: string }>;
}

export async function doctor(
  cortexBaseUrl = "http://127.0.0.1:8420/api/v1",
  workspace = "default",
): Promise<DoctorResult> {
  const checks: Record<string, { pass: boolean; detail: string }> = {};

  // 1. Cortex API health
  const client = new CortexClient({ base_url: cortexBaseUrl, workspace });
  const healthy = await client.health();
  checks.cortex_api = {
    pass: healthy,
    detail: healthy ? `可达: ${cortexBaseUrl}` : `不可达: ${cortexBaseUrl}`,
  };

  // 2. iLink account file
  const hasAccount = existsSync(ACCOUNT_PATH);
  checks.ilink_account = {
    pass: hasAccount,
    detail: hasAccount ? `已存在: ${ACCOUNT_PATH}` : `未找到: ${ACCOUNT_PATH} (需要 QR 扫码认证)`,
  };

  // 3. State directory writable
  let dirOk = false;
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    dirOk = existsSync(STATE_DIR);
  } catch { /* ignore */ }
  checks.state_dir = {
    pass: dirOk,
    detail: dirOk ? `可写: ${STATE_DIR}` : `不可写: ${STATE_DIR}`,
  };

  const ok = Object.values(checks).every((c) => c.pass);
  return { ok, checks };
}

/** CLI entry point for doctor */
export async function runDoctorCli() {
  const cortexBaseUrl = process.env.CORTEX_BASE_URL ?? "http://127.0.0.1:8420/api/v1";
  const workspace = process.env.CORTEX_WORKSPACE ?? "default";
  const result = await doctor(cortexBaseUrl, workspace);

  console.log("\nCortex iLink Agent — Preflight Check\n");
  for (const [name, check] of Object.entries(result.checks)) {
    const icon = check.pass ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${name}: ${check.detail}`);
  }
  console.log(`\n${result.ok ? "全部检查通过。" : "有检查未通过，请修复后重试。"}`);
  process.exit(result.ok ? 0 : 1);
}
