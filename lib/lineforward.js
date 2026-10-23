// ===== ใช้ LINE OA เดียวร่วมกับระบบอื่น (เช่น เว็บส่วนตัวของที่พักที่มีคำสั่งของตัวเอง) =====
// LINE OA ตั้ง Webhook ได้แค่ 1 URL → ให้มาที่ Barn Park แล้ว Barn Park ส่งต่อ "ข้อความที่ไม่ใช่ของ Barn Park" ไปที่ Webhook เดิม
// ระบบเดิมตรวจลายเซ็นด้วย Channel secret ของ OA เดียวกันได้ตามปกติ (เราเซ็นใหม่ด้วย secret เดียวกันเมื่อคัดเฉพาะบาง event)
import crypto from "crypto";
import { baseUrl } from "./baseurl.js";

// ตรวจ URL ปลายทางที่เจ้าของใส่ — https เท่านั้น · ห้ามชี้กลับมาที่ webhook ของเราเอง (วนไม่จบ) · ห้ามชี้เข้าเครือข่ายภายใน
export function cleanForwardUrl(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" || s.length > 500 || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
  let own = "";
  try { own = new URL(baseUrl()).hostname.toLowerCase(); } catch {}
  if ((own && host === own) || /\/api\/line\/(webhook|platform-webhook)/.test(u.pathname)) return null;
  return u.toString();
}

// ส่งต่อ event ไปยังระบบเดิม — ส่งครบทุก event = ส่งตัวเดิม + ลายเซ็นเดิม · คัดบางส่วน = เซ็นใหม่ด้วย Channel secret
export async function forwardEvents(h, { body, events, rawBody, signature, all }) {
  const url = h && h.lineForwardUrl;
  if (!url || !events.length) return { sent: false };
  const payload = all && rawBody ? rawBody : Buffer.from(JSON.stringify({ destination: (body && body.destination) || "", events }));
  const sig = all && rawBody && signature ? signature : h.lineChannelSecret ? crypto.createHmac("sha256", h.lineChannelSecret).update(payload).digest("base64") : signature || "";
  try {
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json", "x-line-signature": sig, "user-agent": "BarnPark-LineForward/1.0" },
      body: payload, signal: AbortSignal.timeout(10000), redirect: "manual",
    });
    if (!r.ok) console.warn("line forward", h.slug, r.status);
    return { sent: true, status: r.status };
  } catch (e) { console.warn("line forward", h.slug, e.message); return { sent: false, error: e.message }; }
}
