import { Router } from "express";
import crypto from "crypto";
import Hotel from "../models/Hotel.js";
import LineChat from "../models/LineChat.js";
import * as L from "../lib/line.js";
import { handleEvents } from "../lib/linebot.js";
import { handleGuestEvent } from "../lib/guestbot.js";
import { setupRichMenus, menuIds } from "../lib/richmenu.js";
import { rememberBase, baseUrl } from "../lib/baseurl.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";

const r = Router();

// Webhook ต่อโรงแรม (LINE OA ของโรงแรมเอง) — ตั้งใน LINE Developers Console เป็น:
//   https://<your-app>.onrender.com/api/line/webhook/<slug>
// ตั้ง Channel secret แล้ว → เปิดบอทจองห้องของแขก (lib/guestbot.js): เช็คห้องว่าง จอง ชำระเงิน ในแชท
// ยังไม่ตั้ง secret → โหมดตั้งค่า: ตอบ userId/groupId กลับ เอาไปวางในช่อง "LINE ผู้รับแจ้งเตือน" (ไม่เปิดรับจอง เพราะตรวจลายเซ็นไม่ได้)
const seenGuest = new Set();
r.post("/webhook/:slug", async (req, res) => {
  const h = await Hotel.findOne({ slug: req.params.slug }).select("+lineChannelToken +lineChannelSecret").lean();
  if (!h || !h.lineChannelToken) return res.sendStatus(200); // ตอบ 200 เสมอ กัน LINE retry
  const events = (req.body && req.body.events) || [];

  if (!h.lineChannelSecret) {
    for (const ev of events) {
      const uid = ev?.source?.userId, gid = ev?.source?.groupId;
      if (ev.type !== "message" || !ev.replyToken) continue;
      const msg = gid
        ? `groupId ของกลุ่มนี้คือ:\n${gid}\nนำไปวางในช่อง "LINE ผู้รับแจ้งเตือน" ในหน้าตั้งค่า BARN-PARK`
        : `userId ของคุณคือ:\n${uid}\nนำไปวางในช่อง "LINE ผู้รับแจ้งเตือน" ในหน้าตั้งค่า BARN-PARK เพื่อรับแจ้งเตือนเมื่อมีจองใหม่\n\n(ใส่ Channel secret ในหน้าตั้งค่าด้วย เพื่อเปิดให้แขกจองห้องผ่านแชทนี้)`;
      await L.replyAs(h.lineChannelToken, ev.replyToken, [{ type: "text", text: msg }]).catch((e) => console.error("line reply", e.message));
    }
    return res.sendStatus(200);
  }

  if (!L.verifySignature(req.rawBody, req.get("x-line-signature"), h.lineChannelSecret)) return res.sendStatus(401);
  rememberBase(req);
  res.sendStatus(200); // ตอบ LINE ทันที แล้วค่อยประมวลผล
  for (const ev of events) {
    const id = ev.webhookEventId;
    if (id) { if (seenGuest.has(id)) continue; seenGuest.add(id); if (seenGuest.size > 2000) seenGuest.delete(seenGuest.values().next().value); }
    const gid = ev?.source?.groupId || ev?.source?.roomId;
    if (gid) { // กลุ่มของทีมที่พัก: พิมพ์ "id" เพื่อดู groupId (บอทไม่รับจองในกลุ่ม)
      if (ev.type === "message" && /^(id|groupid|ไอดี)$/i.test(String(ev.message?.text || "").trim()))
        await L.replyAs(h.lineChannelToken, ev.replyToken, [{ type: "text", text: `groupId ของกลุ่มนี้คือ:\n${gid}` }]).catch(() => {});
      continue;
    }
    await handleGuestEvent(h, ev).catch((e) => console.error("guestbot", h.slug, e));
  }
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
