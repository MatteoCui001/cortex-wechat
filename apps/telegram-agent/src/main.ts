/**
 * Cortex Telegram Agent — Mode A entry point (scaffold).
 *
 * Connects to Telegram Bot API, routes messages through the shared
 * core CommandRouter, and replies via Telegram.
 *
 * Setup:
 *   1. Create a bot via @BotFather on Telegram
 *   2. Set TELEGRAM_BOT_TOKEN in ~/.cortex/env
 *   3. Run: bun run start:telegram
 */
import { CommandRouter, CortexClient } from "@cortex-wechat/core";
import type { InboundMessage } from "@cortex-wechat/core";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CORTEX_BASE_URL = process.env.CORTEX_BASE_URL ?? "http://127.0.0.1:8420/api/v1";
const CORTEX_WORKSPACE = process.env.CORTEX_WORKSPACE ?? "default";
const ALLOWED_CHAT_IDS = process.env.TELEGRAM_ALLOWED_CHAT_IDS?.split(",").map(Number).filter(Boolean) ?? [];

if (!TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required. Get one from @BotFather on Telegram.");
  process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

interface TGUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from: { id: number; username?: string; first_name: string };
    text?: string;
    date: number;
  };
}

async function tgGet(method: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${TG_API}/${method}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
  return data.result;
}

async function tgSend(chatId: number, text: string) {
  await tgGet("sendMessage", {
    chat_id: String(chatId),
    text,
    parse_mode: "Markdown",
  });
}

async function main() {
  console.log("[telegram] Starting Cortex Telegram Agent...");

  const client = new CortexClient({
    base_url: CORTEX_BASE_URL,
    workspace: CORTEX_WORKSPACE,
    api_token: process.env.CORTEX_API_TOKEN,
  });

  const healthy = await client.health();
  if (!healthy) {
    console.warn("[telegram] Cortex API not reachable, continuing anyway...");
  }

  const router = new CommandRouter(client);
  let offset = 0;

  console.log("[telegram] Polling for updates...");

  while (true) {
    try {
      const updates: TGUpdate[] = await tgGet("getUpdates", {
        offset: String(offset),
        timeout: "30",
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text) continue;

        // Authorization check
        if (ALLOWED_CHAT_IDS.length > 0 && !ALLOWED_CHAT_IDS.includes(msg.chat.id)) {
          console.log(`[telegram] Unauthorized chat ${msg.chat.id}, ignoring`);
          continue;
        }

        console.log(`[telegram] Message from ${msg.from.username ?? msg.from.first_name}: ${msg.text.slice(0, 60)}`);

        const inbound: InboundMessage = {
          session_id: String(msg.chat.id),
          user_id: String(msg.from.id),
          message_id: String(msg.message_id),
          text: msg.text,
          platform: "telegram",
          timestamp: new Date(msg.date * 1000).toISOString(),
        };

        try {
          const reply = await router.route(inbound);
          if (reply.reply_text) {
            // Split long messages (Telegram limit is 4096 chars)
            const chunks = reply.reply_text.match(/[\s\S]{1,4000}/g) ?? [];
            for (const chunk of chunks) {
              await tgSend(msg.chat.id, chunk);
            }
          }
        } catch (err) {
          console.error("[telegram] Route error:", err);
          await tgSend(msg.chat.id, "处理失败，请稍后重试。");
        }
      }
    } catch (err) {
      console.error("[telegram] Poll error:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((err) => {
  console.error("[telegram] Fatal:", err);
  process.exit(1);
});
