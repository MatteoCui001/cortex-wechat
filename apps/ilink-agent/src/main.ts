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
    log(`账号加载成功: ${account!.ilink_bot_id}`);
  }
  if (existsSync(CURSOR_PATH)) {
    cursor = readFileSync(CURSOR_PATH, "utf-8").trim();
  }
  if (existsSync(DEDUP_PATH)) {
    const ids: number[] = JSON.parse(readFileSync(DEDUP_PATH, "utf-8"));
    for (const id of ids.slice(-MAX_SEEN)) seenIds.add(id);
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

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// --- Auth ---

async function authenticate(): Promise<ILinkAccount> {
  log("开始认证，请扫描二维码...");
  const qr = await getQRCode();

  // Save QR image
  const qrPath = join(STATE_DIR, "qr.png");
  const qrBuf = Buffer.from(qr.qrcode_img_content, "base64");
  writeFileSync(qrPath, qrBuf);
  log(`二维码已保存: ${qrPath}`);
  log("请用微信扫码 -> 确认登录");

  // Poll for confirmation
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    const result = await checkQRStatus(qr.qrcode);

    if (result.status === "confirmed" && result.account) {
      log("认证成功!");
      saveAccount(result.account);
      return result.account;
    }
    if (result.status === "expired") {
      log("二维码已过期，重新生成...");
      return authenticate(); // recurse for new QR
    }
    log(`等待扫码... (${result.status})`);
  }
}

// --- Main loop ---

async function pollLoop(router: CommandRouter) {
  log("开始监听微信消息...");

  while (true) {
    try {
      const result = await getUpdates(account!, cursor);

      if (result.expired) {
        log("会话过期 (errcode -14)，需要重新认证");
        account = await authenticate();
        continue;
      }

      cursor = result.cursor;
      saveCursor();

      for (const msg of result.messages) {
        await handleMessage(msg, router);
      }
    } catch (err: any) {
      log(`轮询错误: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function handleMessage(msg: ILinkMessage, router: CommandRouter) {
  // Skip bot messages
  if (msg.message_type === 2) return;
  // Dedup
  if (seenIds.has(msg.message_id)) return;
  seenIds.add(msg.message_id);
  saveSeenIds();

  const text = extractText(msg);
  if (!text) {
    // Non-text messages not supported yet
    await sendMessage(account!, msg.from_user_id, msg.context_token, "暂不支持此消息类型，请发送文本。");
    return;
  }

  log(`收到: [${msg.from_user_id.slice(0, 8)}] ${text.slice(0, 50)}`);

  const inbound: InboundMessage = {
    session_id: msg.session_id,
    user_id: msg.from_user_id,
    message_id: String(msg.message_id),
    text,
    context_token: msg.context_token,
    platform: "ilink",
    timestamp: new Date(msg.create_time_ms).toISOString(),
  };

  const reply = await router.route(inbound);
  const chunks = splitReply(reply.reply_text);

  for (const chunk of chunks) {
    const ok = await sendMessage(account!, msg.from_user_id, msg.context_token, chunk);
    if (!ok) log(`发送失败: ${chunk.slice(0, 30)}`);
  }

  log(`回复: [${reply.actions_taken.join(",")}] ${reply.reply_text.slice(0, 50)}`);
}

// --- Entry ---

async function main() {
  log("Cortex iLink Agent 启动");
  loadState();

  if (!account) {
    account = await authenticate();
  }

  // Check Cortex health
  const client = new CortexClient({
    base_url: CORTEX_BASE_URL,
    workspace: CORTEX_WORKSPACE,
  });

  const healthy = await client.health();
  if (!healthy) {
    log(`警告: Cortex API (${CORTEX_BASE_URL}) 无法连接，消息处理可能失败`);
  } else {
    log(`Cortex API 连接正常: ${CORTEX_BASE_URL}`);
  }

  const router = new CommandRouter(client);
  await pollLoop(router);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
