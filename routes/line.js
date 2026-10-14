import { Router } from "express";
import crypto from "crypto";
import Hotel from "../models/Hotel.js";
import LineChat from "../models/LineChat.js";
import * as L from "../lib/line.js";
import { handleEvents } from "../lib/linebot.js";
import { setupRichMenus, menuIds } from "../lib/richmenu.js";
import { rememberBase, baseUrl } from "../lib/baseurl.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";

const r = Router();

// Webhook ต่อโรงแรม (LINE OA ของโรงแรมเอง) — ตั้งใน LINE Developers Console เป็น:
//   https://<your-app>.onrender.com/api/line/webhook/<slug>
// เมื่อเจ้าของ (หรือใครก็ตาม) ทักแชตเข้า OA ระบบจะตอบ userId กลับไป
// เอาไว้ก็อปวางในช่อง "LINE ผู้รับแจ้งเตือน" ของหน้าตั้งค่า
r.post("/webhook/:slug", async (req, res) => {
  const h = await Hotel.findOne({ slug: req.params.slug }).select("+lineChannelToken +lineChannelSecret");
  if (!h || !h.lineChannelToken) return res.sendStatus(200); // ตอบ 200 เสมอ กัน LINE retry

  // ตรวจลายเซ็น (ถ้าตั้ง secret ไว้)
  if (h.lineChannelSecret && !L.verifySignature(req.rawBody, req.get("x-line-signature"), h.lineChannelSecret)) return res.sendStatus(401);

  const events = (req.body && req.body.events) || [];
  for (const ev of events) {
    const uid = ev?.source?.userId;
    const gid = ev?.source?.groupId;
    if (ev.type === "message" && ev.replyToken) {
      const msg = gid
        ? `groupId ของกลุ่มนี้คือ:\n${gid}\nนำไปวางในช่อง "LINE ผู้รับแจ้งเตือน" ในหน้าตั้งค่า BARN-PARK`
        : `userId ของคุณคือ:\n${uid}\nนำไปวางในช่อง "LINE ผู้รับแจ้งเตือน" ในหน้าตั้งค่า BARN-PARK เพื่อรับแจ้งเตือนเมื่อมีจองใหม่`;
      try {
        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: { authorization: "Bearer " + h.lineChannelToken, "content-type": "application/json" },
          body: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: "text", text: msg }] }),
        });
      } catch (e) { console.error("line reply", e); }
    }
  }
  res.sendStatus(200);
});

// ===== Webhook ของ LINE OA กลาง "Barn Park" — บอทให้โรงแรมสมัคร + จัดการที่พักผ่านแชท =====
// ตั้งใน LINE Developers → channel ของ Barn Park → Messaging API → Webhook URL:
//   https://<app>.onrender.com/api/line/platform-webhook
// ต้องตั้ง env: LINE_CHANNEL_TOKEN + LINE_CHANNEL_SECRET
r.post("/platform-webhook", async (req, res) => {
  if (!L.lineReady()) return res.sendStatus(200);
  const secret = process.env.LINE_CHANNEL_SECRET || "";
  if (!secret) {
    // ยังไม่ตั้ง secret → โหมดเดิม: แค่ตอบ userId (เอาไปใส่ ADMIN_LINE_TO) — บอทจัดการที่พักยังปิดอยู่
    console.warn("LINE_CHANNEL_SECRET ยังไม่ได้ตั้ง — บอทจัดการที่พักปิดอยู่");
    for (const ev of (req.body && req.body.events) || []) {
      if (ev.type === "message" && ev.replyToken) {
        const id = ev?.source?.groupId || ev?.source?.userId;
        L.reply(ev.replyToken, [{ type: "text", text: `id ของคุณคือ:\n${id}\nนำไปใส่ env ADMIN_LINE_TO · ตั้ง LINE_CHANNEL_SECRET เพื่อเปิดบอทจัดการที่พัก` }]).catch(() => {});
      }
    }
    return res.sendStatus(200);
  }
  if (!L.verifySignature(req.rawBody, req.get("x-line-signature"), secret)) return res.sendStatus(401);
  rememberBase(req);
  res.sendStatus(200); // ตอบ LINE ทันที แล้วค่อยประมวลผล
  handleEvents((req.body && req.body.events) || []).catch((e) => console.error("linebot", e));
});

// ===== แอดมิน: ติดตั้งเมนู LINE (rich menu) + ดูสถานะ =====
r.get("/status", requireAuth, requireAdmin, async (req, res) => {
  rememberBase(req);
  const ids = await menuIds();
  const [linked, chats] = await Promise.all([
    LineChat.countDocuments({ hotel: { $ne: null } }),
    LineChat.countDocuments({}),
  ]);
  res.json({
    tokenSet: L.lineReady(), secretSet: !!process.env.LINE_CHANNEL_SECRET,
    adminLineTo: !!process.env.ADMIN_LINE_TO, supportUrl: process.env.SUPPORT_LINE_URL || "",
    webhookUrl: baseUrl() + "/api/line/platform-webhook",
    richMenu: ids && ids.hotel ? { installed: true, at: ids.at || null } : { installed: false },
    chats, linkedHotels: linked,
  });
});

r.post("/richmenu/setup", requireAuth, requireAdmin, async (req, res) => {
  rememberBase(req);
  try { res.json({ ok: true, ...(await setupRichMenus()) }); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

export default r;
