/**
 * Cortex Doctor — system health diagnostics.
 * Run via: cortex doctor  (or: bun run start:ilink -- doctor)
 */

const CORTEX_BASE_URL = process.env.CORTEX_BASE_URL ?? "http://127.0.0.1:8420/api/v1";
const ENV_FILE = `${process.env.HOME}/.cortex/env`;
const ACCOUNT_PATH = `${process.env.HOME}/.cortex/wechat/account.json`;

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

async function checkPostgres(): Promise<CheckResult> {
  try {
    const proc = Bun.spawnSync(["psql", "-d", "cortex", "-tAc", "SELECT count(*) FROM events"], {
      timeout: 5000,
    });
    if (proc.exitCode === 0) {
      const count = proc.stdout.toString().trim();
      return { name: "PostgreSQL", status: "ok", detail: `Connected, ${count} events` };
    }
    return { name: "PostgreSQL", status: "fail", detail: `Exit code ${proc.exitCode}` };
  } catch {
    return { name: "PostgreSQL", status: "fail", detail: "psql not found or connection failed" };
  }
}

async function checkAPI(): Promise<CheckResult> {
  try {
    const res = await fetch(`${CORTEX_BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return { name: "Cortex API", status: "ok", detail: `Healthy at ${CORTEX_BASE_URL}` };
    return { name: "Cortex API", status: "fail", detail: `HTTP ${res.status}` };
  } catch (e: any) {
    return { name: "Cortex API", status: "fail", detail: e.message ?? "Connection refused" };
  }
}

async function checkLLM(): Promise<CheckResult> {
  try {
    const res = await fetch(`${CORTEX_BASE_URL}/settings`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { name: "LLM Config", status: "warn", detail: "Could not check settings" };
    const data: any = await res.json();
    if (data.llm?.configured) {
      return { name: "LLM Config", status: "ok", detail: `Model: ${data.llm.model}` };
    }
    return { name: "LLM Config", status: "warn", detail: "Not configured — signals and entity extraction disabled" };
  } catch {
    return { name: "LLM Config", status: "warn", detail: "API not reachable" };
  }
}

async function checkWeChat(): Promise<CheckResult> {
  try {
    const { existsSync, readFileSync, statSync } = await import("fs");
    if (!existsSync(ACCOUNT_PATH)) {
      return { name: "WeChat Session", status: "fail", detail: "No session file — run QR scan" };
    }
    const stat = statSync(ACCOUNT_PATH);
    const age = Date.now() - stat.mtimeMs;
    const days = Math.floor(age / 86400000);
    const account = JSON.parse(readFileSync(ACCOUNT_PATH, "utf-8"));
    if (days > 7) {
      return { name: "WeChat Session", status: "warn", detail: `Session ${days}d old — may need re-scan` };
    }
    return { name: "WeChat Session", status: "ok", detail: `Bot ID: ${account.ilink_bot_id}, ${days}d old` };
  } catch {
    return { name: "WeChat Session", status: "fail", detail: "Could not read session file" };
  }
}

async function checkEnv(): Promise<CheckResult> {
  try {
    const { existsSync, readFileSync } = await import("fs");
    if (!existsSync(ENV_FILE)) {
      return { name: "Environment", status: "fail", detail: `${ENV_FILE} not found` };
    }
    const content = readFileSync(ENV_FILE, "utf-8");
    const hasToken = /CORTEX_API_TOKEN=".+"/.test(content);
    const hasLLM = /LLM_API_KEY=".+"/.test(content) && !/LLM_API_KEY=""/.test(content);
    if (!hasToken) return { name: "Environment", status: "fail", detail: "CORTEX_API_TOKEN not set" };
    if (!hasLLM) return { name: "Environment", status: "warn", detail: "LLM_API_KEY not set (optional)" };
    return { name: "Environment", status: "ok", detail: "Token and LLM key configured" };
  } catch {
    return { name: "Environment", status: "fail", detail: "Could not read env file" };
  }
}

async function checkDisk(): Promise<CheckResult> {
  try {
    const proc = Bun.spawnSync(["df", "-h", process.env.HOME!], { timeout: 5000 });
    const lines = proc.stdout.toString().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const used = parts[4]; // e.g., "85%"
      const pct = parseInt(used);
      if (pct > 90) return { name: "Disk Space", status: "warn", detail: `${used} used — consider cleanup` };
      return { name: "Disk Space", status: "ok", detail: `${used} used, ${parts[3]} available` };
    }
    return { name: "Disk Space", status: "ok", detail: "Could not parse" };
  } catch {
    return { name: "Disk Space", status: "ok", detail: "Check skipped" };
  }
}

export async function doctor(): Promise<CheckResult[]> {
  return Promise.all([
    checkEnv(),
    checkPostgres(),
    checkAPI(),
    checkLLM(),
    checkWeChat(),
    checkDisk(),
  ]);
}

export async function runDoctorCli() {
  const RED = "\x1b[31m";
  const GREEN = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const BOLD = "\x1b[1m";
  const NC = "\x1b[0m";

  console.log(`\n${BOLD}Cortex Doctor${NC}\n`);

  const results = await doctor();
  let hasIssue = false;

  for (const r of results) {
    const icon = r.status === "ok" ? `${GREEN}✓${NC}` : r.status === "warn" ? `${YELLOW}!${NC}` : `${RED}✗${NC}`;
    console.log(`  ${icon} ${BOLD}${r.name}${NC}: ${r.detail}`);
    if (r.status !== "ok") hasIssue = true;
  }

  console.log("");
  if (hasIssue) {
    console.log(`${YELLOW}Some checks need attention.${NC}`);
  } else {
    console.log(`${GREEN}All systems healthy.${NC}`);
  }

  process.exit(hasIssue ? 1 : 0);
}
