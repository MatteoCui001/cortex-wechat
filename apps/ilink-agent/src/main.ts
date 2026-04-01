/**
 * Cortex iLink Agent — Mode A entry point.
 *
 * Connects directly to WeChat via iLink long-poll, routes messages
 * through the shared core CommandRouter, and replies via iLink.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { CommandRouter, CortexClient, splitReply } from "@cortex-wechat/core";
import type { InboundMessage, LLMConfig } from "@cortex-wechat/core";
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
import { loadRecipient, saveRecipient } from "./recipient";

// --- Config ---

const WELCOME_TEXT = `欢迎使用 Cortex!

你的个人知识引擎已就绪。以下是常用命令:

收录: 直接发送链接或文字
收件箱: 查看待处理通知
日报: 最近 7 天摘要
论点: 查看投资论点
搜索 <关键词>: 搜索知识库
统计: 系统概览

发送"帮助"查看完整命令列表。`;

const STATE_DIR = join(homedir(), ".cortex", "wechat");
const ACCOUNT_PATH = join(STATE_DIR, "account.json");
const CURSOR_PATH = join(STATE_DIR, "cursor.txt");
const DEDUP_PATH = join(STATE_DIR, "seen_ids.json");

const CORTEX_BASE_URL = process.env.CORTEX_BASE_URL ?? "http://127.0.0.1:8420/api/v1";
const CORTEX_WORKSPACE = process.env.CORTEX_WORKSPACE ?? "default";
const DISPATCH_INTERVAL_MS = Number(process.env.DISPATCH_INTERVAL_MS) || 60_000; // 1 min default

// Sender whitelist — enforced via env var or auto-lock on first message.
// Priority: ALLOWED_SENDER_IDS env > persisted file > auto-lock first sender.
const ALLOWED_SENDERS_PATH = join(STATE_DIR, "allowed_senders.json");

let allowedSenders: Set<string> | null = (() => {
  // 1. Explicit env var takes priority
  const raw = process.env.ALLOWED_SENDER_IDS?.trim();
  if (raw) return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  // 2. Load from persisted file (auto-locked from previous run)
  if (existsSync(ALLOWED_SENDERS_PATH)) {
    try {
      const ids: string[] = JSON.parse(readFileSync(ALLOWED_SENDERS_PATH, "utf-8"));
      if (ids.length > 0) return new Set(ids);
    } catch { /* corrupt file, will re-lock */ }
  }
  // 3. Not set — will auto-lock on first message
  return null;
})();

function autoLockSender(userId: string) {
  allowedSenders = new Set([userId]);
  ensureDir();
  writeFileSync(ALLOWED_SENDERS_PATH, JSON.stringify([userId]), { mode: 0o600 });
  log("auth", `首次消息，已自动锁定授权用户: ${userId.slice(0, 8)}...`);
}

// LLM semantic routing — optional, falls back to regex when absent
const LLM_BASE_URL = process.env.LLM_BASE_URL;
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL;
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 6000;

function buildLLMConfig(): LLMConfig | undefined {
  if (!LLM_BASE_URL || !LLM_API_KEY) return undefined;
  return {
    base_url: LLM_BASE_URL,
    api_key: LLM_API_KEY,
    model: LLM_MODEL,
    timeout_ms: LLM_TIMEOUT_MS,
  };
}

// --- State ---

let account: ILinkAccount | null = null;
let cursor = "";
const seenIds = new Set<number>();
const MAX_SEEN = 1000;

// Content-based dedup: iLink may assign different message_ids to the same
// message on reconnect.  Key = "user_id:text_hash", value = timestamp.
const seenContent = new Map<string, number>();
const CONTENT_DEDUP_WINDOW_MS = 30_000; // 30 seconds

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

async function authenticate(maxRetries = 5): Promise<ILinkAccount> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(5000 * attempt, 30000);
      log("auth", `第 ${attempt + 1}/${maxRetries} 次重试，${delay / 1000}s 后获取新二维码...`);
      await new Promise((r) => setTimeout(r, delay));
    }

    log("auth", "开始认证，请扫描二维码...");
    const qr = await getQRCode();

    // qrcode_img_content is a URL, not base64 PNG
    const qrUrl = qr.qrcode_img_content;
    log("auth", `扫码链接: ${qrUrl}`);
    log("auth", "请在微信中打开上方链接，或用另一台设备扫码 -> 确认登录");

    let expired = false;
    while (!expired) {
      await new Promise((r) => setTimeout(r, 3000));
      const result = await checkQRStatus(qr.qrcode);

      if (result.status === "confirmed" && result.account) {
        log("auth", "认证成功!");
        saveAccount(result.account);
        return result.account;
      }
      if (result.status === "expired") {
        log("auth", "二维码已过期，重新生成...");
        expired = true;
      } else {
        log("auth", `等待扫码... (${result.status})`);
      }
    }
  }
  throw new Error(`认证失败: ${maxRetries} 次二维码均已过期，请检查网络或手动重启`);
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

  // Sender whitelist — reject unauthorized senders or auto-lock first one
  if (allowedSenders) {
    if (!allowedSenders.has(msg.from_user_id)) {
      log("auth", `拒绝未授权发送者: ${msg.from_user_id.slice(0, 8)}`);
      return;
    }
  } else {
    // First message ever — auto-lock this sender as the owner
    autoLockSender(msg.from_user_id);
    // Send welcome message on first connection
    sendMessage(account!, msg.from_user_id, msg.context_token, WELCOME_TEXT).catch((err) => log("send", `欢迎消息发送失败: ${err}`));
  }

  // Dedup by message_id
  if (seenIds.has(msg.message_id)) {
    log("poll", `去重跳过 (id): message_id=${msg.message_id}`);
    return;
  }
  seenIds.add(msg.message_id);
  saveSeenIds();

  // Track primary recipient for push notifications
  saveRecipient(msg.from_user_id, msg.context_token);

  const text = extractText(msg);

  // Content-based dedup: iLink may re-deliver with a new message_id
  if (text) {
    const contentKey = `${msg.from_user_id}:${text.slice(0, 100)}`;
    const lastSeen = seenContent.get(contentKey);
    if (lastSeen && Date.now() - lastSeen < CONTENT_DEDUP_WINDOW_MS) {
      log("poll", `去重跳过 (content): ${text.slice(0, 40)}`);
      return;
    }
    seenContent.set(contentKey, Date.now());
    // Evict old entries
    if (seenContent.size > MAX_SEEN) {
      const cutoff = Date.now() - CONTENT_DEDUP_WINDOW_MS;
      for (const [k, ts] of seenContent) {
        if (ts < cutoff) seenContent.delete(k);
      }
    }
  }
  if (!text) {
    // Check for image/voice/file/video — acknowledge with specific message
    const itemType = msg.item_list[0]?.type;
    const typeNames: Record<number, string> = { 2: "图片", 3: "语音", 4: "文件", 5: "视频" };
    const typeName = typeNames[itemType] ?? "此类型";
    log("route", `非文本消息 (type=${itemType ?? "?"}), 回复不支持提示`);
    const ok = await sendMessage(account!, msg.from_user_id, msg.context_token,
      `暂不支持${typeName}消息，请发送文本或链接。`);
    if (!ok) logError("send", "不支持提示发送失败");
    return;
  }

  log("route", `收到: [${msg.from_user_id.slice(0, 8)}] ${text.slice(0, 60)}`);

  // Send processing confirmation for non-trivial operations
  // (skip for simple commands like help, inbox, stats that respond fast)
  const trimmed = text.trim();
  const isQuickCommand = /^(?:帮助|help|\?|收件箱|inbox|通知|统计|stats|状态|论点|theses?|thesis\s*list|日报|digest|摘要|菜单|menu|命令)(?:\s+\d+)?$/i.test(trimmed)
    || /^(?:搜索|search|找)\s/i.test(trimmed);
  if (!isQuickCommand) {
    sendMessage(account!, msg.from_user_id, msg.context_token, "收到，处理中...").catch(() => {});
  }

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

// --- Notification dispatch loop ---

// Track recently pushed notification IDs to prevent duplicate sends
// when deliverNotification fails but sendMessage succeeded.
const recentlyPushed = new Map<string, number>();
const PUSH_DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

async function dispatchLoop(client: CortexClient) {
  log("system", `通知推送循环启动 (间隔 ${DISPATCH_INTERVAL_MS / 1000}s)`);

  while (true) {
    await new Promise((r) => setTimeout(r, DISPATCH_INTERVAL_MS));

    try {
      const recipient = loadRecipient();
      if (!recipient) {
        // No active session — skip silently
        continue;
      }

      const pending = await client.getDeliverableNotifications(5);
      if (pending.length === 0) continue;

      // Evict expired dedup entries
      const now = Date.now();
      for (const [k, ts] of recentlyPushed) {
        if (now - ts > PUSH_DEDUP_WINDOW_MS) recentlyPushed.delete(k);
      }

      log("send", `推送 ${pending.length} 条通知给 ${recipient.user_id.slice(0, 8)}`);

      for (const notif of pending) {
        // Skip if we already sent this notification recently
        if (recentlyPushed.has(notif.id)) {
          log("send", `通知 ${notif.short_id} 跳过 (已推送，等待投递确认)`);
          // Retry deliverNotification in case it failed last time
          await client.deliverNotification(notif.id).catch(() => {});
          continue;
        }

        const marker = notif.priority === "high" ? "!!!" : notif.priority === "medium" ? " ! " : "   ";
        const bodyLine = notif.body ? `\n${notif.body}` : "";
        const actions = [`确认 ${notif.short_id}`, `已读 ${notif.short_id}`, `忽略 ${notif.short_id}`];
        if (notif.signal_id) actions.push(`有用 ${notif.signal_id.slice(0, 7)}`);
        const text = `[${marker}] ${notif.title}${bodyLine}\n\n回复: ${actions.join(" / ")}`;

        const ok = await sendMessage(
          account!,
          recipient.user_id,
          recipient.context_token,
          text,
        );

        if (ok) {
          // Track as sent to prevent duplicate pushes
          recentlyPushed.set(notif.id, Date.now());
          // Mark as delivered in Cortex
          const result = await client.deliverNotification(notif.id);
          if (result.ok) {
            log("send", `通知 ${notif.short_id} 推送并标记已投递`);
          } else {
            logError("cortex_api", `通知 ${notif.short_id} 投递标记失败 (已防重复): ${result.error}`);
          }
        } else {
          logError("send", `通知 ${notif.short_id} 推送发送失败`);
        }
      }
    } catch (err) {
      logError("send", "推送循环错误", err);
    }
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
  if (allowedSenders) {
    log("auth", `发送者白名单已启用: ${allowedSenders.size} 个授权用户`);
  } else {
    log("auth", "首次运行: 将自动锁定第一个发消息的微信用户为唯一授权用户");
  }
  loadState();

  if (!account) {
    account = await authenticate();
  }

  // Preflight: check Cortex health
  const client = new CortexClient({
    base_url: CORTEX_BASE_URL,
    workspace: CORTEX_WORKSPACE,
    api_token: process.env.CORTEX_API_TOKEN,
  });

  const healthy = await client.health();
  if (!healthy) {
    log("system", `警告: Cortex API (${CORTEX_BASE_URL}) 无法连接`);
    log("system", "恢复动作: 确保 Cortex 已启动 (cd ~/Projects/cortex && make serve)");
    log("system", "继续运行，但消息处理可能失败...");
  } else {
    log("cortex_api", `连接正常: ${CORTEX_BASE_URL}`);
  }

  const llmConfig = buildLLMConfig();
  const router = new CommandRouter(client, llmConfig ? { llm: llmConfig } : undefined);

  if (router.llmEnabled) {
    log("system", `路由模式: LLM + regex fallback (model=${llmConfig!.model ?? "default"}, timeout=${llmConfig!.timeout_ms}ms)`);
  } else {
    log("system", "路由模式: regex-only (设置 LLM_BASE_URL + LLM_API_KEY 启用语义路由)");
  }

  // Wire up LLM event logging
  router.onLLMEvent = (event, reason) => {
    if (event === "llm_success") {
      log("route", "LLM 语义路由命中");
    } else {
      log("route", `LLM 降级到 regex (${reason ?? "unknown"})`);
    }
  };

  // Dual loop: message poll + notification dispatch
  await Promise.all([
    pollLoop(router),
    dispatchLoop(client),
  ]);
}

main().catch((err) => {
  logError("system", "致命错误", err);
  process.exit(1);
});
