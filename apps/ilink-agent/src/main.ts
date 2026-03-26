/**
 * Cortex iLink Agent — Mode A entry point.
 *
 * Connects directly to WeChat via iLink long-poll, routes messages
 * through the shared core CommandRouter, and replies via iLink.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { CommandRouter, CortexClient, splitReply } from "../../packages/core/src/index";
import type { InboundMessage } from "../../packages/core/src/types";
import {
  type ILinkAccount,
  type ILinkMessage,
  checkQRStatus,
  extractText,
  getQRCode,
  getUpdates,
  sendMessage,
} from "./ilink-api";
import { log, logError } from "./logger";
import { doctor, runDoctorCli } from "./doctor";

// --- Config ---

const STATE_DIR = join(homedir(), ".cortex", "wechat");
const ACCOUNT_PATH = join(STATE_DIR, "account.json");
const CURSOR_PATH = join(STATE_DIR, "cursor.txt");
const DEDUP_PATH = join(STATE_DIR, "seen_ids.json");

const CORTEX_BASE_URL = process.env.CORTEX_BASE_URL ?? "http://127.0.0.1:8420/api/v1";
const CORTEX_WORKSPACE = process.env.CORTEX_WORKSPACE ?? "default";

// --- State ---

let account: ILinkAccount | null = null;
let cursor = "";
const seenIds = new Set<number>();
const MAX_SEEN = 1000;

function ensureDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

function loadState() {
  ensureDir();
  if (existsSync(ACCOUNT_PATH)) {
    account = JSON.parse(readFileSync(ACCOUNT_PATH, "utf-8"));
    log("auth", `账号加载成功: ${account!.ilink_bot_id}`);
  }
  if (existsSync(CURSOR_PATH)) {
    cursor = readFileSync(CURSOR_PATH, "utf-8").trim();
    log("poll", `游标恢复: ${cursor.slice(0, 20)}...`);
  }
  if (existsSync(DEDUP_PATH)) {
    const ids: number[] = JSON.parse(readFileSync(DEDUP_PATH, "utf-8"));
    for (const id of ids.slice(-MAX_SEEN)) seenIds.add(id);
    log("poll", `去重缓存恢复: ${seenIds.size} 条`);
  }
}

function saveAccount(acc: ILinkAccount) {
  ensureDir();
  writeFileSync(ACCOUNT_PATH, JSON.stringify(acc, null, 2), { mode: 0o600 });
}

function saveCursor() {
  writeFileSync(CURSOR_PATH, cursor, { mode: 0o600 });
}

function saveSeenIds() {
  const arr = [...seenIds].slice(-MAX_SEEN);
  writeFileSync(DEDUP_PATH, JSON.stringify(arr), { mode: 0o600 });
}

// --- Auth ---

async function authenticate(): Promise<ILinkAccount> {
  log("auth", "开始认证，请扫描二维码...");
  const qr = await getQRCode();

  const qrPath = join(STATE_DIR, "qr.png");
  const qrBuf = Buffer.from(qr.qrcode_img_content, "base64");
  writeFileSync(qrPath, qrBuf);
  log("auth", `二维码已保存: ${qrPath}`);
  log("auth", "请用微信扫码 -> 确认登录");

  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    const result = await checkQRStatus(qr.qrcode);

    if (result.status === "confirmed" && result.account) {
      log("auth", "认证成功!");
      saveAccount(result.account);
      return result.account;
    }
    if (result.status === "expired") {
      log("auth", "二维码已过期，重新生成...");
      return authenticate();
    }
    log("auth", `等待扫码... (${result.status})`);
  }
}

// --- Main loop ---

async function pollLoop(router: CommandRouter) {
  log("poll", "开始监听微信消息...");
  let consecutiveErrors = 0;

  while (true) {
    try {
      const result = await getUpdates(account!, cursor);

      if (result.expired) {
        log("auth", "会话过期 (errcode -14)，重新认证");
        account = await authenticate();
        consecutiveErrors = 0;
        continue;
      }

      consecutiveErrors = 0;
      cursor = result.cursor;
      saveCursor();

      for (const msg of result.messages) {
        await handleMessage(msg, router);
      }
    } catch (err: any) {
      consecutiveErrors++;
      const backoff = Math.min(5000 * consecutiveErrors, 60_000);
      logError("poll", `轮询错误 (连续第${consecutiveErrors}次)，${backoff / 1000}s 后重试`, err);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

async function handleMessage(msg: ILinkMessage, router: CommandRouter) {
  // Skip bot messages
  if (msg.message_type === 2) return;

  // Dedup
  if (seenIds.has(msg.message_id)) {
    log("poll", `去重跳过: message_id=${msg.message_id}`);
    return;
  }
  seenIds.add(msg.message_id);
  saveSeenIds();

  const text = extractText(msg);
  if (!text) {
    log("route", `非文本消息 (type=${msg.item_list[0]?.type ?? "?"}), 回复不支持提示`);
    const ok = await sendMessage(account!, msg.from_user_id, msg.context_token, "暂不支持此消息类型，请发送文本。");
    if (!ok) logError("send", "不支持提示发送失败");
    return;
  }

  log("route", `收到: [${msg.from_user_id.slice(0, 8)}] ${text.slice(0, 60)}`);

  const inbound: InboundMessage = {
    session_id: msg.session_id,
    user_id: msg.from_user_id,
    message_id: String(msg.message_id),
    text,
    context_token: msg.context_token,
    platform: "ilink",
    timestamp: new Date(msg.create_time_ms).toISOString(),
  };

  let reply;
  try {
    reply = await router.route(inbound);
  } catch (err) {
    logError("cortex_api", "路由处理失败", err);
    const fallback = "处理失败，Cortex API 可能不可用。请稍后重试。";
    await sendMessage(account!, msg.from_user_id, msg.context_token, fallback);
    return;
  }

  const chunks = splitReply(reply.reply_text);
  log("route", `回复: [${reply.actions_taken.join(",")}] ${chunks.length} 条消息`);

  for (let i = 0; i < chunks.length; i++) {
    const ok = await sendMessage(account!, msg.from_user_id, msg.context_token, chunks[i]);
    if (ok) {
      log("send", `消息 ${i + 1}/${chunks.length} 发送成功`);
    } else {
      logError("send", `消息 ${i + 1}/${chunks.length} 发送失败: ${chunks[i].slice(0, 30)}`);
    }
  }

  if (reply.errors.length > 0) {
    logError("cortex_api", `操作有错误: ${reply.errors.join(", ")}`);
  }
}

// --- Entry ---

async function main() {
  // Handle doctor subcommand
  if (process.argv.includes("doctor") || process.argv.includes("--doctor")) {
    await runDoctorCli();
    return; // runDoctorCli calls process.exit
  }

  log("system", "Cortex iLink Agent 启动");
  loadState();

  if (!account) {
    account = await authenticate();
  }

  // Preflight: check Cortex health
  const client = new CortexClient({
    base_url: CORTEX_BASE_URL,
    workspace: CORTEX_WORKSPACE,
  });

  const healthy = await client.health();
  if (!healthy) {
    log("system", `警告: Cortex API (${CORTEX_BASE_URL}) 无法连接`);
    log("system", "恢复动作: 确保 Cortex 已启动 (cd ~/Projects/cortex && make serve)");
    log("system", "继续运行，但消息处理可能失败...");
  } else {
    log("cortex_api", `连接正常: ${CORTEX_BASE_URL}`);
  }

  const router = new CommandRouter(client);
  await pollLoop(router);
}

main().catch((err) => {
  logError("system", "致命错误", err);
  process.exit(1);
});
