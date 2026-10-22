// ===== LINE Messaging API — สำหรับ LINE OA กลางของ Barn Park =====
// ใช้ env: LINE_CHANNEL_TOKEN (Channel access token) + LINE_CHANNEL_SECRET (ตรวจลายเซ็น webhook)
import crypto from "crypto";

const API  = () => process.env.LINE_API_BASE  || "https://api.line.me";      // เปลี่ยนได้เฉพาะตอนทดสอบ
const DATA = () => process.env.LINE_DATA_BASE || "https://api-data.line.me";
const TOKEN = () => process.env.LINE_CHANNEL_TOKEN || "";

export const lineReady = () => !!TOKEN();

export function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody || Buffer.from("")).digest("base64");
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function call(method, url, body, extraHeaders = {}) {
  const headers = { authorization: "Bearer " + TOKEN(), ...extraHeaders };
  let payload;
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) payload = body;
    else { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  }
  const r = await fetch(url, { method, headers, body: payload });
  const text = await r.text();
  if (!r.ok) throw new Error(`LINE ${method} ${url.replace(/^https?:\/\/[^/]+/, "")} → ${r.status} ${text.slice(0, 300)}`);
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

// ตอบกลับ (ฟรี ไม่นับโควตา) — ได้สูงสุด 5 ข้อความต่อครั้ง
export async function reply(replyToken, messages) {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean).slice(0, 5);
  if (!replyToken || !list.length || !lineReady()) return;
  return call("POST", API() + "/v2/bot/message/reply", { replyToken, messages: list });
}

// ตอบกลับในนาม LINE OA ของโรงแรมเอง (token ต่อโรงแรม — ใช้กับบอทจองของแขก)
export async function replyAs(token, replyToken, messages) {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean).slice(0, 5);
  if (!token || !replyToken || !list.length) return;
  const r = await fetch(API() + "/v2/bot/message/reply", {
    method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ replyToken, messages: list }),
  });
  if (!r.ok) throw new Error(`LINE reply (OA โรงแรม) → ${r.status} ${(await r.text()).slice(0, 300)}`);
}

// ส่งหา (นับโควตาข้อความของ OA) — ใช้เฉพาะแจ้งเตือนสำคัญ เช่น อนุมัติแล้ว
export async function push(to, messages) {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean).slice(0, 5);
  if (!to || !list.length || !lineReady()) return;
  return call("POST", API() + "/v2/bot/message/push", { to, messages: list });
}

export async function getProfile(userId) {
  try { return await call("GET", API() + "/v2/bot/profile/" + encodeURIComponent(userId)); }
  catch { return null; }
}

// โชว์ "กำลังพิมพ์…" ระหว่างประมวลผล (เช่น ตอนย่อรูป) — พังก็ไม่เป็นไร
export async function showLoading(userId, seconds = 10) {
  try { await call("POST", API() + "/v2/bot/chat/loading/start", { chatId: userId, loadingSeconds: seconds }); } catch {}
}

// ดึงไฟล์รูปที่ผู้ใช้ส่งมา (ต้องดึงทันทีหลังได้ webhook)
export async function getContent(messageId) {
  const r = await fetch(DATA() + "/v2/bot/message/" + encodeURIComponent(messageId) + "/content", {
    headers: { authorization: "Bearer " + TOKEN() },
  });
  if (!r.ok) throw new Error("LINE content " + r.status);
  const len = +(r.headers.get("content-length") || 0);
  if (len > 15 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกินไป");
  return Buffer.from(await r.arrayBuffer());
}

// ===== Rich menu =====
export const richMenu = {
  create: (def) => call("POST", API() + "/v2/bot/richmenu", def),
  upload: (id, buf, type = "image/png") => call("POST", DATA() + "/v2/bot/richmenu/" + id + "/content", buf, { "content-type": type }),
  list: () => call("GET", API() + "/v2/bot/richmenu/list"),
  remove: (id) => call("DELETE", API() + "/v2/bot/richmenu/" + id),
  setDefault: (id) => call("POST", API() + "/v2/bot/user/all/richmenu/" + id),
  linkUser: (userId, id) => call("POST", API() + "/v2/bot/user/" + encodeURIComponent(userId) + "/richmenu/" + id),
  unlinkUser: (userId) => call("DELETE", API() + "/v2/bot/user/" + encodeURIComponent(userId) + "/richmenu"),
};
