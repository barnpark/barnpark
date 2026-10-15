import { Router } from "express";
import bcrypt from "bcryptjs";
import Hotel from "../models/Hotel.js";
import User from "../models/User.js";
import RoomType from "../models/RoomType.js";
import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import ActivityBooking from "../models/ActivityBooking.js";
import Feedback from "../models/Feedback.js";
import { requireAuth, requireAdmin, canAccessHotel } from "../lib/auth.js";
import LineChat from "../models/LineChat.js";
import { issueLinkCode, fmtCode, oaAddUrl, oaPrefillUrl, approveHotel } from "../lib/onboard.js";
import { detachHotelFromChat } from "../lib/linebot.js";
import { rememberBase } from "../lib/baseurl.js";
import { badImageFields } from "../lib/security.js";
import { normalizePromptPayId } from "../lib/promptpay.js";
import { cleanStayFields } from "../lib/stay.js";
import { checklist } from "../lib/checklist.js";
import { announceUpdate, announceLog } from "../lib/announce.js";

const r = Router();

// ===== จัดการที่พักผ่าน LINE Barn Park =====
// ขอรหัสเชื่อม (เจ้าของ/แอดมิน) — พิมพ์รหัสนี้ใน LINE Barn Park เพื่อเปิดเมนูจัดการที่พัก
r.post("/hotels/:id/line-code", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const h = await Hotel.findById(req.params.id);
  if (!h) return res.status(404).json({ error: "not found" });
  if (h.approved === false) return res.status(400).json({ error: "ที่พักยังรออนุมัติ — อนุมัติแล้วจึงขอรหัสเชื่อม LINE ได้" });
  const owner = req.user.role === "admin"
    ? await User.findOne({ hotel: h._id, role: "owner" }).sort("createdAt")
    : await User.findById(req.user.id);
  const code = await issueLinkCode(h._id, owner?._id, 7);
  res.json({ code: fmtCode(code), expiresInDays: 7, addFriendUrl: oaAddUrl(), sendCodeUrl: oaPrefillUrl("เชื่อม " + fmtCode(code)) });
});
// LINE ที่เชื่อมกับที่พักนี้อยู่
r.get("/hotels/:id/line-links", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const list = await LineChat.find({ hotels: req.params.id }).select("name hotel updatedAt").lean();
  res.json(list.map((c) => ({ id: c._id, name: c.name || "ผู้ใช้ LINE", active: String(c.hotel) === String(req.params.id), updatedAt: c.updatedAt })));
});
// ถอดสิทธิ์ LINE นั้นออกจากที่พัก
r.delete("/hotels/:id/line-links/:cid", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const c = await LineChat.findOne({ _id: req.params.cid, hotels: req.params.id }).lean();
  if (!c) return res.status(404).json({ error: "not found" });
  await detachHotelFromChat(c._id, req.params.id);
  res.json({ ok: true });
});
// แอดมินอนุมัติที่พัก → ออกรหัสเชื่อม → ส่งให้ผู้สมัครทาง LINE (ถ้าสมัครผ่าน LINE) + อีเมล
r.post("/admin/hotels/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  rememberBase(req);
  try { res.json({ ok: true, ...(await approveHotel(req.params.id)) }); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// สำรองข้อมูลทั้งระบบเป็น JSON (แอดมินเท่านั้น) — กดดาวน์โหลดเก็บไว้เอง
r.get("/admin/export", requireAuth, requireAdmin, async (_req, res) => {
  const [hotels, users, rooms, bookings, services, activityBookings, feedback] = await Promise.all([
    Hotel.find().lean(), User.find().select("-passwordHash -otpHash").lean(),
    RoomType.find().lean(), Booking.find().lean(), Service.find().lean(), ActivityBooking.find().lean(), Feedback.find().lean(),
  ]);
  res.setHeader("Content-Disposition", 'attachment; filename="barnpark-backup-' + new Date().toISOString().slice(0, 10) + '.json"');
  res.json({ exportedAt: new Date().toISOString(), hotels, users, rooms, bookings, services, activityBookings, feedback });
});

// เพิ่มโรงแรมใหม่ + สร้างบัญชีเจ้าของ (admin เท่านั้น)
r.post("/hotels/onboard", requireAuth, requireAdmin, async (req, res) => {
  const { name, slug, location, ownerEmail, ownerPassword, ownerName } = req.body || {};
  if (!name || !slug || !ownerEmail || !ownerPassword)
    return res.status(400).json({ error: "กรอกชื่อโรงแรม, slug, อีเมลและรหัสเจ้าของให้ครบ" });
  const s = String(slug).toLowerCase().trim();
  if (await Hotel.findOne({ slug: s })) return res.status(409).json({ error: "slug นี้ถูกใช้แล้ว" });
  if (await User.findOne({ email: String(ownerEmail).toLowerCase() })) return res.status(409).json({ error: "อีเมลนี้มีบัญชีแล้ว" });
  const hotel = await Hotel.create({
    name, slug: s, location: location || "", status: "onboarding",
    ota: [{ channel: "agoda", status: 0 }, { channel: "booking", status: 0 }, { channel: "trip", status: 0 }],
  });
  await User.create({
    email: String(ownerEmail).toLowerCase(), role: "owner", name: ownerName || name,
    hotel: hotel._id, passwordHash: bcrypt.hashSync(ownerPassword, 10),
  });
  res.json({ ok: true, hotel });
});

// list — admin เห็นทุกที่ / staff เห็นเฉพาะของตัวเอง
r.get("/hotels", requireAuth, async (req, res) => {
  const q = req.user.role === "admin" ? {} : { _id: req.user.hotel };
  res.json(await Hotel.find(q).sort("createdAt"));
});

r.get("/hotels/:id", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const h = await Hotel.findById(req.params.id);
  if (!h) return res.status(404).json({ error: "not found" });
  res.json(h);
});

r.post("/hotels", requireAuth, requireAdmin, async (req, res) => {
  if (badImageFields(req.body, ["coverUrl", "promoImage"])) return res.status(400).json({ error: "ลิงก์รูปไม่ถูกต้อง" });
  try { res.json(await Hotel.create(req.body)); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

r.patch("/hotels/:id", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const { lineChannelToken, lineChannelSecret, coverData, _id, ...safe } = req.body || {}; // secret ผ่าน route แยกเท่านั้น
  if (req.user.role !== "admin") { delete safe.approved; delete safe.status; delete safe.planFee; delete safe.slug; delete safe.ota; } // เจ้าของอนุมัติตัวเอง/แก้ค่าบริการไม่ได้
  if (badImageFields(safe, ["coverUrl", "promoImage"])) return res.status(400).json({ error: "ลิงก์รูปไม่ถูกต้อง (ใช้ลิงก์ https)" });
  if (safe.promptpayId !== undefined && String(safe.promptpayId).trim() !== "") {
    const pp = normalizePromptPayId(safe.promptpayId);
    if (!pp) return res.status(400).json({ error: "เบอร์พร้อมเพย์ไม่ถูกต้อง — ใช้เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน/เลขนิติบุคคล 13 หลัก" });
    safe.promptpayId = pp;
  }
  const stayErr = cleanStayFields(safe); if (stayErr) return res.status(400).json({ error: stayErr });
  if (safe.holdHours !== undefined) safe.holdHours = Math.max(0, Math.min(720, parseInt(safe.holdHours, 10) || 0));
  if (safe.cancelDays !== undefined) safe.cancelDays = Math.max(0, Math.min(60, parseInt(safe.cancelDays, 10) || 0));
  res.json(await Hotel.findByIdAndUpdate(req.params.id, safe, { new: true }));
});

// เช็กความครบของที่พัก (แดชบอร์ดเจ้าของ)
r.get("/hotels/:id/checklist", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const h = await Hotel.findById(req.params.id).lean();
  if (!h) return res.status(404).json({ error: "not found" });
  const c = await checklist(h);
  res.json({ ...c, items: c.items.map(({ key, label, must, web, ok }) => ({ key, label, must: !!must, web, ok })), missing: undefined, mustMissing: c.mustMissing.length });
});

// ===== แอดมิน: ภาพรวมความครบทุกที่พัก + แจ้งอัปเดตระบบ =====
r.get("/admin/checklist", requireAuth, requireAdmin, async (_req, res) => {
  const hotels = await Hotel.find().sort("createdAt").lean();
  const out = [];
  for (const h of hotels) {
    const c = await checklist(h);
    const linked = await LineChat.countDocuments({ hotels: h._id });
    out.push({ id: h._id, name: h.name, slug: h.slug, approved: h.approved !== false, linked, done: c.done, total: c.total, pct: c.pct, missing: c.missing.map((i) => i.label) });
  }
  res.json(out);
});
// ส่งประกาศ "อัปเดตระบบ" + เช็กลิสต์เฉพาะของแต่ละที่ เข้า LINE Barn Park ของทุกคนที่เชื่อมที่พัก (+อีเมล)
//   body: { title, message, dryRun, email, onlyMissing }
r.post("/admin/announce", requireAuth, requireAdmin, async (req, res) => {
  rememberBase(req);
  const { title = "", message = "", dryRun = true, email = false, onlyMissing = false } = req.body || {};
  if (!String(title).trim()) return res.status(400).json({ error: "ใส่หัวข้อประกาศ" });
  try { res.json(await announceUpdate({ title: String(title).slice(0, 80), message: String(message).slice(0, 1500), dryRun: dryRun !== false, email: !!email, onlyMissing: !!onlyMissing })); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
r.get("/admin/announce/log", requireAuth, requireAdmin, async (_req, res) => res.json(await announceLog()));

// ===== LINE OA ต่อโรงแรม =====
// ดูสถานะการเชื่อม (ไม่คืน token)
r.get("/hotels/:id/line", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const h = await Hotel.findById(req.params.id).select("+lineChannelToken lineId");
  res.json({ lineId: h?.lineId || "", connected: !!(h && h.lineChannelToken) });
});
// บันทึกการเชื่อม (token เก็บใน DB, select:false ไม่หลุด API ปกติ)
r.patch("/hotels/:id/line", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const { lineId, lineChannelToken, lineChannelSecret } = req.body || {};
  const set = { lineId };
  if (lineChannelToken !== undefined) set.lineChannelToken = lineChannelToken;
  if (lineChannelSecret !== undefined) set.lineChannelSecret = lineChannelSecret;
  await Hotel.findByIdAndUpdate(req.params.id, set);
  res.json({ ok: true });
});

export default r;
