/**
 * iLink API client — handles auth, polling, and sending.
 *
 * Based on the WeChat ClawBot iLink protocol:
 *   - Long-poll via POST /ilink/bot/getupdates
 *   - Send via POST /ilink/bot/sendmessage
 *   - QR auth via /ilink/bot/get_bot_qrcode + /ilink/bot/get_qrcode_status
 */

const ILINK_BASE = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "1.0.2";
const POLL_TIMEOUT_MS = 35_000;

export interface ILinkAccount {
  bot_token: string;
  ilink_bot_id: string;
  ilink_user_id: string;
}

export interface ILinkMessage {
  seq: number;
  message_id: number;
  from_user_id: string;
  to_user_id: string;
  client_id: string;
  create_time_ms: number;
  session_id: string;
  group_id: string;
  message_type: number;
  message_state: number;
  context_token: string;
  item_list: Array<{
    type: number; // 1=TEXT, 2=IMAGE, 3=VOICE, 4=FILE, 5=VIDEO
    text_item?: { text: string };
    image_item?: any;
    voice_item?: any;
    file_item?: any;
    video_item?: any;
  }>;
}

function makeHeaders(account: ILinkAccount): Record<string, string> {
  const uin = btoa(String(Math.floor(Math.random() * 4294967295)));
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${account.bot_token}`,
    "X-WECHAT-UIN": uin,
  };
}

function baseInfo() {
  return { channel_version: CHANNEL_VERSION };
}

// --- Auth ---

export interface QRCodeResult {
  qrcode: string;
  qrcode_img_content: string; // base64 PNG
}

export async function getQRCode(): Promise<QRCodeResult> {
  const res = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`);
  const data: any = await res.json();
  return { qrcode: data.qrcode, qrcode_img_content: data.qrcode_img_content };
}

export async function checkQRStatus(
  qrcode: string,
): Promise<{ status: string; account?: ILinkAccount }> {
  const res = await fetch(
    `${ILINK_BASE}/ilink/bot/get_qrcode_status?qrcode=${qrcode}`,
    { headers: { "iLink-App-ClientVersion": "1" } },
  );
  const data: any = await res.json();
  if (data.status === "confirmed" && data.bot_token) {
    return {
      status: "confirmed",
      account: {
        bot_token: data.bot_token,
        ilink_bot_id: data.ilink_bot_id,
        ilink_user_id: data.ilink_user_id,
      },
    };
  }
  return { status: data.status ?? "unknown" };
}

// --- Polling ---

export async function getUpdates(
  account: ILinkAccount,
  cursor: string,
): Promise<{ messages: ILinkMessage[]; cursor: string; expired: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS + 5000);

  try {
    const res = await fetch(`${ILINK_BASE}/ilink/bot/getupdates`, {
      method: "POST",
      headers: makeHeaders(account),
      body: JSON.stringify({
        get_updates_buf: cursor,
        base_info: baseInfo(),
      }),
      signal: controller.signal,
    });
    const data: any = await res.json();

    if (data.errcode === -14 || data.ret === -14) {
      return { messages: [], cursor, expired: true };
    }

    return {
      messages: data.msgs ?? [],
      cursor: data.get_updates_buf ?? cursor,
      expired: false,
    };
  } catch (err: any) {
    // Timeout or network error — not fatal, just retry
    if (err.name === "AbortError") {
      return { messages: [], cursor, expired: false };
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Sending ---

export async function sendMessage(
  account: ILinkAccount,
  toUserId: string,
  contextToken: string,
  text: string,
): Promise<boolean> {
  const clientId = `ilink-bot:${Date.now()}-${crypto.randomUUID().replace(/-/g, "")}`;

  const res = await fetch(`${ILINK_BASE}/ilink/bot/sendmessage`, {
    method: "POST",
    headers: makeHeaders(account),
    body: JSON.stringify({
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        context_token: contextToken,
        item_list: [{ type: 1, text_item: { text } }],
      },
      base_info: baseInfo(),
    }),
  });
  const data: any = await res.json();
  // iLink may return ret !== 0 but still deliver; log for debugging
  if (data.ret !== 0) {
    console.error(`[iLink sendmessage] ret=${data.ret} errcode=${data.errcode ?? "?"} errmsg=${data.errmsg ?? JSON.stringify(data).slice(0, 200)}`);
  }
  return data.errcode === undefined || data.errcode === 0 || data.ret === 0;
}

// --- Extract text from message ---

export function extractText(msg: ILinkMessage): string {
  for (const item of msg.item_list) {
    if (item.type === 1 && item.text_item?.text) {
      return item.text_item.text;
    }
  }
  return "";
}
