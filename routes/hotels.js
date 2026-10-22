import { Router } from "express";
import mongoose from "mongoose";
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
import { rememberBase, baseUrl } from "../lib/baseurl.js";
import { badImageFields } from "../lib/security.js";
import { normalizePromptPayId } from "../lib/promptpay.js";
import { cleanStayFields, cleanLineId } from "../lib/stay.js";
import { cleanPayFields } from "../lib/pay.js";
import { parseDataUrl, toDataUrl, toLogoDataUrl } from "../lib/images.js";
import { checklist } from "../lib/checklist.js";
import { announceUpdate, announceLog, changelogStatus } from "../lib/announce.js";
import { composeAnnouncement } from "../lib/changelog.js";
import Setting from "../models/Setting.js";
import PromoCode from "../models/PromoCode.js";
import Review from "../models/Review.js";
import LinkCode from "../models/LinkCode.js";
import { CALC_KEY, cleanCalc } from "../lib/calc.js";
import { storageReport, migrateImages } from "../lib/storage.js";
import { storeReady, storeInfo, putImage, storeImageFields, removeByUrl, removePrefix } from "../lib/filestore.js";
import { exportData, runBackup, listBackups, backupLink } from "../lib/backup.js";

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
  const data = await exportData();
  res.setHeader("Content-Disposition", 'attachment; filename="barnpark-backup-' + new Date().toISOString().slice(0, 10) + '.json"');
  res.json(data);
});

// เพิ่มโรงแรมใหม่ + สร้างบัญชีเจ้าของ (admin เท่านั้น)
r.post("/hotels/onboard", requireAuth, requireAdmin, async (req, res) => {
  const { name, slug, location, ownerEmail, ownerPassword, ownerName } = req.body || {};
  if (!name || !slug || !ownerEmail || !ownerPassword)
    return res.status(400).json({ error: "กรอกชื่อโรงแรม, slug, อีเมลและรหัสเจ้าของให้ครบ" });
  if (String(ownerPassword).length < 8) return res.status(400).json({ error: "รหัสผ่านเจ้าของอย่างน้อย 8 ตัวอักษร" });
  const s = String(slug).toLowerCase().trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(s)) return res.status(400).json({ error: "slug ใช้ a-z 0-9 และ - เท่านั้น (ไม่เกิน 60 ตัว)" });
  if (await Hotel.findOne({ slug: s })) return res.status(409).json({ error: "slug นี้ถูกใช้แล้ว" });
  if (await User.findOne({ email: String(ownerEmail).toLowerCase() })) return res.status(409).json({ error: "อีเมลนี้มีบัญชีแล้ว" });
  const hotel = await Hotel.create({
    name, slug: s, location: location || "", status: "onboarding",
    ota: [{ channel: "agoda", status: 0 }, { channel: "booking", status: 0 }, { channel: "trip", status: 0 }],
  });
  await User.create({
    email: String(ownerEmail).toLowerCase(), role: "owner", name: ownerName || name,
    hotel: hotel._id, passwordHash: bcrypt.hashSync(String(ownerPassword), 10),
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
  if (badImageFields(req.body, ["coverUrl", "promoImage", "logoUrl"])) return res.status(400).json({ error: "ลิงก์รูปไม่ถูกต้อง" });
  try { const id = new mongoose.Types.ObjectId(); const body = { ...req.body, _id: id }; await storeImageFields(body, HOTEL_IMG, `h/${id}/img`); res.json(await Hotel.create(body)); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

const HOTEL_IMG = ["coverUrl", "promoImage", "logoUrl"];
// ฟิลด์ที่แก้ผ่าน PATCH /hotels/:id ได้ (whitelist) — token/secret ผ่าน /line · รูปที่เก็บในระบบผ่าน /cover /logo เท่านั้น
const HOTEL_OWNER_FIELDS = ["name", "location", "phone", "lineId", "brandColor", "brandColor2", "accentColor", "accentColor2", "fontFamily", "uiStyle", "template",
  "tagline", "coverUrl", "logoUrl", "about", "amenities", "promoText", "promoImage", "notifyEmail", "notifyLineTo", "promptpayId", "promptpayName",
  "payPromptpay", "payTransfer", "payOnsite", "bankName", "bankAccountNo", "bankAccountName", "taxId", "address",
  "checkInTime", "checkOutTime", "mapUrl", "houseRules", "allowGuestCancel", "cancelDays", "holdHours"];
const HOTEL_ADMIN_FIELDS = [...HOTEL_OWNER_FIELDS, "status", "approved", "planFee", "slug", "ota"]; // อนุมัติ/ค่าบริการ/สถานะ/slug/OTA = แอดมินเท่านั้น
const HOTEL_STATUS = ["active", "onboarding", "paused"], OTA_CH = ["agoda", "booking", "trip", "airbnb"];
const COLOR_RE = /^#[0-9a-f]{3,8}$/i;
r.patch("/hotels/:id", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const body = req.body || {}, isAdmin = req.user.role === "admin", safe = {};
  for (const k of isAdmin ? HOTEL_ADMIN_FIELDS : HOTEL_OWNER_FIELDS) if (body[k] !== undefined) safe[k] = body[k];
  const str = (k, n) => { if (safe[k] !== undefined) safe[k] = String(safe[k] ?? "").trim().slice(0, n); };
  str("name", 120); str("location", 200); str("phone", 40); str("promptpayName", 120); str("taxId", 20); str("notifyLineTo", 80);
  str("fontFamily", 40); str("uiStyle", 20); str("template", 20);
  if (safe.name !== undefined && !safe.name) return res.status(400).json({ error: "ต้องมีชื่อที่พัก" });
  for (const k of ["brandColor", "brandColor2", "accentColor", "accentColor2"]) if (safe[k] !== undefined && !COLOR_RE.test(String(safe[k]))) return res.status(400).json({ error: "รหัสสีไม่ถูกต้อง (เช่น #0d9488)" });
  if (safe.notifyEmail !== undefined) { safe.notifyEmail = String(safe.notifyEmail || "").trim().slice(0, 120); if (safe.notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safe.notifyEmail)) return res.status(400).json({ error: "อีเมลรับแจ้งเตือนไม่ถูกต้อง" }); }
  if (safe.allowGuestCancel !== undefined) safe.allowGuestCancel = safe.allowGuestCancel === true || safe.allowGuestCancel === "true";
  if (isAdmin) {
    if (safe.status !== undefined && !HOTEL_STATUS.includes(safe.status)) return res.status(400).json({ error: "สถานะไม่ถูกต้อง" });
    if (safe.approved !== undefined) safe.approved = safe.approved === true || safe.approved === "true";
    if (safe.planFee !== undefined) safe.planFee = Math.max(0, Math.min(100000, Math.round(Number(safe.planFee) || 0)));
    if (safe.slug !== undefined) {
      safe.slug = String(safe.slug || "").toLowerCase().trim();
      if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(safe.slug)) return res.status(400).json({ error: "slug ใช้ a-z 0-9 และ - เท่านั้น (ไม่เกิน 60 ตัว)" });
      if (await Hotel.findOne({ slug: safe.slug, _id: { $ne: req.params.id } }).select("_id").lean()) return res.status(409).json({ error: "slug นี้ถูกใช้แล้ว" });
    }
    if (safe.ota !== undefined) safe.ota = (Array.isArray(safe.ota) ? safe.ota : []).filter((o) => o && OTA_CH.includes(o.channel)).slice(0, OTA_CH.length)
      .map((o) => ({ channel: o.channel, status: Math.max(0, Math.min(3, parseInt(o.status, 10) || 0)), propertyId: String(o.propertyId || "").slice(0, 60), ...(o.requestedAt && !isNaN(new Date(o.requestedAt)) ? { requestedAt: new Date(o.requestedAt) } : {}) }));
  }
  if (badImageFields(safe, ["coverUrl", "promoImage", "logoUrl"])) return res.status(400).json({ error: "ลิงก์รูปไม่ถูกต้อง (ใช้ลิงก์ https)" });
  if (safe.promptpayId !== undefined && String(safe.promptpayId).trim() !== "") {
    const pp = normalizePromptPayId(safe.promptpayId);
    if (!pp) return res.status(400).json({ error: "เบอร์พร้อมเพย์ไม่ถูกต้อง — ใช้เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน/เลขนิติบุคคล 13 หลัก" });
    safe.promptpayId = pp;
  }
  const stayErr = cleanStayFields(safe); if (stayErr) return res.status(400).json({ error: stayErr });
  const payErr = cleanPayFields(safe); if (payErr) return res.status(400).json({ error: payErr });
  if (safe.lineId !== undefined) {
    const v = cleanLineId(safe.lineId);
    if (v === null) return res.status(400).json({ error: "LINE ไม่ถูกต้อง — ใส่ @ID ของ LINE OA (เช่น @baanbaan) หรือลิงก์ lin.ee / line.me" });
    safe.lineId = v;
  }
  if (safe.promoText !== undefined) safe.promoText = String(safe.promoText || "").trim().slice(0, 120);
  if (safe.about !== undefined) safe.about = String(safe.about || "").slice(0, 1000);
  if (safe.tagline !== undefined) safe.tagline = String(safe.tagline || "").slice(0, 120);
  if (safe.amenities !== undefined) safe.amenities = (Array.isArray(safe.amenities) ? safe.amenities : []).map((a) => String(a || "").trim().slice(0, 30)).filter(Boolean).slice(0, 20);
  try { await storeImageFields(safe, HOTEL_IMG, `h/${req.params.id}/img`); }
  catch (e) { return res.status(502).json({ error: "อัปโหลดรูปไม่สำเร็จ: " + (e.message || e) }); }
  if (safe.holdHours !== undefined) safe.holdHours = Math.max(0, Math.min(720, parseInt(safe.holdHours, 10) || 0));
  if (safe.cancelDays !== undefined) safe.cancelDays = Math.max(0, Math.min(60, parseInt(safe.cancelDays, 10) || 0));
  res.json(await Hotel.findByIdAndUpdate(req.params.id, safe, { new: true }));
});

// รูปหน้าปก — อัปโหลดจากเว็บหลังบ้าน (ย่อ + แปลงเป็น JPEG ฝั่งเซิร์ฟเวอร์ เก็บแบบเดียวกับที่ส่งผ่าน LINE)
r.post("/hotels/:id/cover", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const p = parseDataUrl((req.body || {}).image);
  if (!p || !/^image\/(jpe?g|png|webp)$/i.test(p.type)) return res.status(400).json({ error: "ไฟล์ต้องเป็นรูป JPG / PNG / WEBP" });
  if (p.buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: "รูปใหญ่เกินไป (ไม่เกิน 8MB)" });
  let dataUrl;
  try { dataUrl = await toDataUrl(p.buf, { max: 1600, quality: 82 }); }
  catch { return res.status(400).json({ error: "อ่านไฟล์รูปไม่ได้ ลองไฟล์อื่น" }); }
  let coverUrl = `/api/public/img/cover/${req.params.id}/0?v=${Date.now()}`;
  if (storeReady()) { // ตั้ง Supabase แล้ว → เก็บไฟล์บน Supabase เก็บแค่ลิงก์
    try { dataUrl = coverUrl = await putImage(dataUrl, `h/${req.params.id}/cover`); }
    catch (e) { return res.status(502).json({ error: "อัปโหลดรูปไม่สำเร็จ: " + e.message }); }
  }
  const h = await Hotel.findByIdAndUpdate(req.params.id, { $set: { coverData: dataUrl, coverUrl } }).select("+coverData");
  if (!h) return res.status(404).json({ error: "not found" });
  if (h.coverData !== dataUrl) await removeByUrl(h.coverData, `h/${req.params.id}`); // ลบรูปปกเดิม
  res.json({ ok: true, coverUrl });
});
r.delete("/hotels/:id/cover", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const old = await Hotel.findByIdAndUpdate(req.params.id, { $set: { coverUrl: "" }, $unset: { coverData: 1 } }).select("+coverData");
  if (old) await removeByUrl(old.coverData, `h/${req.params.id}`);
  res.json({ ok: true });
});

// โลโก้ที่พัก — อัปโหลดจากเว็บหลังบ้าน (ตัดขอบว่าง + ย่อ + เก็บเป็น PNG พื้นใส)
r.post("/hotels/:id/logo", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const p = parseDataUrl((req.body || {}).image);
  if (!p || !/^image\/(jpe?g|png|webp)$/i.test(p.type)) return res.status(400).json({ error: "ไฟล์ต้องเป็นรูป PNG / JPG / WEBP" });
  if (p.buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: "ไฟล์โลโก้ใหญ่เกินไป (ไม่เกิน 5MB)" });
  let lg;
  try { lg = await toLogoDataUrl(p.buf); }
  catch { return res.status(400).json({ error: "อ่านไฟล์รูปไม่ได้ ลองไฟล์อื่น" }); }
  let logoUrl = `/api/public/img/logo/${req.params.id}/0?v=${Date.now()}`;
  if (storeReady()) {
    try { lg.dataUrl = logoUrl = await putImage(lg.dataUrl, `h/${req.params.id}/logo`); }
    catch (e) { return res.status(502).json({ error: "อัปโหลดรูปไม่สำเร็จ: " + e.message }); }
  }
  const h = await Hotel.findByIdAndUpdate(req.params.id, { $set: { logoData: lg.dataUrl, logoUrl, logoAspect: lg.aspect } }).select("+logoData");
  if (!h) return res.status(404).json({ error: "not found" });
  if (h.logoData !== lg.dataUrl) await removeByUrl(h.logoData, `h/${req.params.id}`); // ลบโลโก้เดิม
  res.json({ ok: true, logoUrl, logoAspect: lg.aspect });
});
r.delete("/hotels/:id/logo", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const old = await Hotel.findByIdAndUpdate(req.params.id, { $set: { logoUrl: "" }, $unset: { logoData: 1, logoAspect: 1 } }).select("+logoData");
  if (old) await removeByUrl(old.logoData, `h/${req.params.id}`);
  res.json({ ok: true });
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
// ===== แอดมิน: พื้นที่ฐานข้อมูลที่แต่ละที่พักใช้ เทียบโควตาฟรี =====
r.get("/admin/storage", requireAuth, requireAdmin, async (_req, res) => {
  try { res.json({ ...(await storageReport()), files: storeInfo() }); }
  catch (e) { res.status(500).json({ error: "นับพื้นที่ไม่สำเร็จ: " + (e.message || e) }); }
});
// ย้ายรูป data URL ในฐานข้อมูลไป Supabase — body: { dryRun, limit, after } (หน้าแอดมินเรียกซ้ำทีละชุดจนครบ)
r.post("/admin/storage/migrate-images", requireAuth, requireAdmin, async (req, res) => {
  const { dryRun = true, limit = 10, after = {} } = req.body || {};
  try { res.json(await migrateImages({ dryRun: dryRun !== false, limit, after: after && typeof after === "object" ? after : {} })); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
// ===== แอดมิน: สำรองข้อมูลอัตโนมัติบน Supabase (bucket ส่วนตัว) =====
r.get("/admin/backups", requireAuth, requireAdmin, async (_req, res) => {
  const info = storeInfo();
  if (!info.ready) return res.json({ ...info, list: [] });
  try { res.json({ ...info, list: (await listBackups()).slice(0, 40) }); }
  catch (e) { res.json({ ...info, list: [], error: e.message }); }
});
r.post("/admin/backups", requireAuth, requireAdmin, async (_req, res) => {
  try { const out = await runBackup(); res.status(out.skipped ? 400 : 200).json(out.skipped ? { error: out.skipped } : out); }
  catch (e) { res.status(502).json({ error: "สำรองข้อมูลไม่สำเร็จ: " + (e.message || e) }); }
});
r.get("/admin/backups/:name/link", requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ url: await backupLink(req.params.name) }); }
  catch (e) { res.status(e.status === 400 ? 400 : 502).json({ error: String(e.message || e) }); }
});
// ส่งประกาศ "อัปเดตระบบ" + เช็กลิสต์เฉพาะของแต่ละที่ เข้า LINE Barn Park ของทุกคนที่เชื่อมที่พัก (+อีเมล)
//   body: { title, message, dryRun, email, onlyMissing }
r.post("/admin/announce", requireAuth, requireAdmin, async (req, res) => {
  rememberBase(req);
  const { title = "", message = "", dryRun = true, email = false, onlyMissing = false, changelogIds = [] } = req.body || {};
  if (!String(title).trim()) return res.status(400).json({ error: "ใส่หัวข้อประกาศ" });
  const ids = (Array.isArray(changelogIds) ? changelogIds : []).slice(0, 50).map(String);
  try { res.json(await announceUpdate({ title: String(title).slice(0, 80), message: String(message).slice(0, 1500), dryRun: dryRun !== false, email: !!email, onlyMissing: !!onlyMissing, changelogIds: ids })); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
r.get("/admin/announce/log", requireAuth, requireAdmin, async (_req, res) => res.json(await announceLog()));
// รายการอัปเดตที่ขึ้นเว็บแล้ว (lib/changelog.js) + ประกาศไปแล้วหรือยัง · ?compose=id1,id2 → ข้อความประกาศจากรายการที่เลือก
r.get("/admin/changelog", requireAuth, requireAdmin, async (req, res) => {
  const ids = String(req.query.compose || "").split(",").filter(Boolean).slice(0, 50);
  res.json({ entries: await changelogStatus(), ...(ids.length ? composeAnnouncement(ids) : {}) });
});

// ===== แอดมิน: ลบที่พักถาวร (ห้อง การจอง บริการ บัญชีเจ้าของ การเชื่อม LINE ฯลฯ) — ต้องพิมพ์ slug ยืนยัน =====
const isOid = (s) => /^[a-f0-9]{24}$/i.test(String(s || ""));
async function hotelFootprint(hid) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const [rooms, bookings, upcoming, services, activityBookings, promos, reviews, users, lineChats, feedback] = await Promise.all([
    RoomType.countDocuments({ hotel: hid }),
    Booking.countDocuments({ hotel: hid }),
    Booking.countDocuments({ hotel: hid, checkout: { $gt: today }, status: { $ne: "cancelled" } }),
    Service.countDocuments({ hotel: hid }),
    ActivityBooking.countDocuments({ hotel: hid }),
    PromoCode.countDocuments({ hotel: hid }),
    Review.countDocuments({ hotel: hid }),
    User.countDocuments({ hotel: hid, role: { $ne: "admin" } }),
    LineChat.countDocuments({ $or: [{ hotels: hid }, { hotel: hid }] }),
    Feedback.countDocuments({ hotel: hid }),
  ]);
  return { rooms, bookings, upcoming, services, activityBookings, promos, reviews, users, lineChats, feedback };
}
r.get("/admin/hotels/:id/delete-preview", requireAuth, requireAdmin, async (req, res) => {
  if (!isOid(req.params.id)) return res.status(404).json({ error: "ไม่พบที่พัก" });
  const h = await Hotel.findById(req.params.id).select("name slug").lean();
  if (!h) return res.status(404).json({ error: "ไม่พบที่พัก" });
  res.json({ name: h.name, slug: h.slug, counts: await hotelFootprint(h._id) });
});
r.post("/admin/hotels/:id/delete", requireAuth, requireAdmin, async (req, res) => {
  if (!isOid(req.params.id)) return res.status(404).json({ error: "ไม่พบที่พัก" });
  const h = await Hotel.findById(req.params.id).select("name slug").lean();
  if (!h) return res.status(404).json({ error: "ไม่พบที่พัก" });
  const typed = String((req.body && req.body.confirm) || "").trim();
  if (!typed || typed !== String(h.slug || "")) return res.status(400).json({ error: "พิมพ์ slug ของที่พักให้ตรงเพื่อยืนยันการลบ" });
  const hid = h._id;
  // ถอดที่พักออกจาก LINE ของทุกคนที่เชื่อมไว้ (ไม่เหลือที่พักแล้ว → กลับเป็นเมนูผู้มาใหม่)
  const chats = await LineChat.find({ $or: [{ hotels: hid }, { hotel: hid }] }).select("_id").lean();
  for (const c of chats) { try { await detachHotelFromChat(c._id, hid); } catch (e) { console.error("detach on delete", e.message); } }
  const del = async (M, q) => (await M.deleteMany(q)).deletedCount || 0;
  const deleted = {
    rooms: await del(RoomType, { hotel: hid }),
    bookings: await del(Booking, { hotel: hid }),
    services: await del(Service, { hotel: hid }),
    activityBookings: await del(ActivityBooking, { hotel: hid }),
    promos: await del(PromoCode, { hotel: hid }),
    reviews: await del(Review, { hotel: hid }),
    linkCodes: await del(LinkCode, { hotel: hid }),
    feedback: await del(Feedback, { hotel: hid }),
    users: await del(User, { hotel: hid, role: { $ne: "admin" } }),
    lineChats: chats.length,
  };
  await Hotel.deleteOne({ _id: hid });
  deleted.files = await removePrefix(`h/${hid}`); // รูปของที่พักนี้บน Supabase (ถ้ามี)
  console.log("admin deleted hotel", h.slug, "by", req.user.id, JSON.stringify(deleted));
  res.json({ ok: true, name: h.name, deleted });
});

// ===== แอดมิน: ตัวคำนวณต้นทุน Channex — ค่าที่กรอกเก็บไว้ให้ทีมเห็นตรงกัน =====
r.get("/admin/calc/channex", requireAuth, requireAdmin, async (_req, res) => {
  const s = await Setting.findOne({ key: CALC_KEY }).lean();
  res.json(s && s.value ? { ...s.value, updatedAt: s.updatedAt } : null);
});
r.post("/admin/calc/channex", requireAuth, requireAdmin, async (req, res) => {
  const me = await User.findById(req.user.id).select("email name").lean();
  const value = { ...cleanCalc(req.body), by: (me && (me.email || me.name)) || "" };
  const s = await Setting.findOneAndUpdate({ key: CALC_KEY }, { $set: { value } }, { upsert: true, new: true }).lean();
  res.json({ ...s.value, updatedAt: s.updatedAt });
});

// ===== LINE OA ต่อโรงแรม =====
// ดูสถานะการเชื่อม (ไม่คืน token)
r.get("/hotels/:id/line", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const h = await Hotel.findById(req.params.id).select("+lineChannelToken +lineChannelSecret lineId");
  // guestBot = แขกเช็คห้องว่าง/จอง/ชำระเงินในแชท OA ได้ (ต้องมีทั้ง token และ secret เพื่อตรวจลายเซ็น)
  res.json({ lineId: h?.lineId || "", connected: !!(h && h.lineChannelToken), guestBot: !!(h && h.lineChannelToken && h.lineChannelSecret) });
});
// บันทึกการเชื่อม (token เก็บใน DB, select:false ไม่หลุด API ปกติ)
// ทดสอบการเชื่อม LINE OA ของโรงแรม (+ ตั้ง Webhook URL ให้อัตโนมัติ) — เช็กทีละขั้นว่าข้อความของแขกมาถึงบอทจองได้ไหม
//   body: { fix: true } = ตั้ง Webhook URL ให้ถูก (ผ่าน LINE API ด้วย token ของโรงแรม)
const LINE_API = () => process.env.LINE_API_BASE || "https://api.line.me";
async function lineCall(token, method, path, body) {
  try {
    const r2 = await fetch(LINE_API() + path, {
      method, headers: { authorization: "Bearer " + token, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    });
    const txt = await r2.text();
    let json = {}; try { json = txt ? JSON.parse(txt) : {}; } catch {}
    return { ok: r2.ok, status: r2.status, json };
  } catch (e) { return { ok: false, status: 0, json: { message: String(e.message || e) } }; }
}
r.post("/hotels/:id/line/check", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  if (!isOid(req.params.id)) return res.status(404).json({ error: "ไม่พบที่พัก" });
  const h = await Hotel.findById(req.params.id).select("+lineChannelToken +lineChannelSecret slug").lean();
  if (!h) return res.status(404).json({ error: "ไม่พบที่พัก" });
  rememberBase(req);
  const steps = [], add = (ok, title, msg) => { steps.push({ ok, title, msg }); return ok; };
  const done = () => res.json({ ok: steps.every((x) => x.ok), steps });
  const base = baseUrl();
  const expected = base + "/api/line/webhook/" + encodeURIComponent(h.slug);

  if (!add(!!h.lineChannelToken, "Channel access token", h.lineChannelToken ? "ใส่แล้ว" : "ยังไม่ได้ใส่ — คัดลอกจาก LINE Developers → Messaging API → Channel access token (long-lived)")) return done();
  const info = await lineCall(h.lineChannelToken, "GET", "/v2/bot/info");
  if (!add(info.ok, "token ใช้งานได้", info.ok ? `เชื่อมกับ OA “${info.json.displayName || ""}” ${info.json.basicId || ""}` : `LINE ไม่รับ token นี้ (${info.status}) — คัดลอก token ใหม่ (Issue) แล้วบันทึกอีกครั้ง`)) return done();
  if (!add(!!h.lineChannelSecret, "Channel secret", h.lineChannelSecret ? "ใส่แล้ว" : "ยังไม่ได้ใส่ — ไม่มี secret บอทจะไม่รับจอง (คัดลอกจาก LINE Developers → Basic settings → Channel secret)")) return done();
  if (!add(/^https:\/\//.test(base), "ที่อยู่เว็บ", /^https:\/\//.test(base) ? base : "ระบบยังไม่รู้ที่อยู่เว็บแบบ https — ตั้ง env PUBLIC_URL ใน Render")) return done();

  let wh = await lineCall(h.lineChannelToken, "GET", "/v2/bot/channel/webhook/endpoint");
  if (wh.ok && wh.json.endpoint !== expected && req.body && req.body.fix) {
    const put = await lineCall(h.lineChannelToken, "PUT", "/v2/bot/channel/webhook/endpoint", { endpoint: expected });
    if (put.ok) wh = await lineCall(h.lineChannelToken, "GET", "/v2/bot/channel/webhook/endpoint");
  }
  const urlOk = wh.ok && wh.json.endpoint === expected;
  add(urlOk, "Webhook URL", urlOk ? expected : `${wh.json.endpoint ? "ตั้งไว้เป็น " + wh.json.endpoint + " (ไม่ตรง)" : "ยังไม่ได้ตั้ง"} — กด “ตั้งค่าให้อัตโนมัติ” หรือวาง ${expected} ใน LINE Developers → Messaging API → Webhook URL`);
  add(!!(wh.ok && wh.json.active), "เปิด Use webhook", wh.ok && wh.json.active ? "เปิดอยู่" : "ยังปิดอยู่ — LINE Developers → Messaging API → เปิดสวิตช์ “Use webhook” (หรือ LINE OA Manager → ตั้งค่า → การตอบกลับ → เปิด Webhook)");
  if (!urlOk) return done();

  // ให้ LINE ยิงข้อความทดสอบมาที่ webhook จริง → รู้ว่าเซิร์ฟเวอร์ตอบได้และ secret ตรง
  const tst = await lineCall(h.lineChannelToken, "POST", "/v2/bot/channel/webhook/test", { endpoint: expected });
  const sc = tst.json.statusCode;
  add(!!(tst.ok && tst.json.success), "LINE ส่งข้อความทดสอบถึงเว็บ",
    tst.ok && tst.json.success ? "ผ่าน ✔ ข้อความของแขกมาถึงบอทจองได้"
      : sc === 401 ? "เว็บปฏิเสธ (401) — Channel secret ไม่ตรงกับ OA นี้ คัดลอก secret ใหม่จาก Basic settings แล้วบันทึก"
      : `ไม่ผ่าน (${sc || tst.status}${tst.json.reason ? " " + tst.json.reason : ""}) — ถ้าเว็บเพิ่งตื่น (Render แพ็กเกจฟรี) ลองกดทดสอบอีกครั้ง`);
  done();
});

r.patch("/hotels/:id/line", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const { lineId, lineChannelToken, lineChannelSecret } = req.body || {};
  const set = {};
  if (lineId !== undefined) {
    const v = cleanLineId(lineId);
    if (v === null) return res.status(400).json({ error: "LINE ไม่ถูกต้อง — ใส่ @ID ของ LINE OA (เช่น @baanbaan) หรือลิงก์ lin.ee / line.me" });
    set.lineId = v;
  }
  if (lineChannelToken !== undefined) set.lineChannelToken = String(lineChannelToken || "").trim();
  if (lineChannelSecret !== undefined) set.lineChannelSecret = String(lineChannelSecret || "").trim();
  // เชื่อม OA ของที่พักแล้ว แต่ยังไม่ได้ใส่ LINE ให้แขกทัก → ดึง @ID ของ OA นั้นมาใส่ให้อัตโนมัติ (ปุ่มแชท LINE บนหน้าจอง)
  if (set.lineChannelToken && lineId === undefined) {
    const cur = await Hotel.findById(req.params.id).select("lineId").lean();
    if (cur && !cur.lineId) {
      try {
        const r2 = await fetch((process.env.LINE_API_BASE || "https://api.line.me") + "/v2/bot/info", { headers: { authorization: "Bearer " + set.lineChannelToken }, signal: AbortSignal.timeout(5000) });
        const info = r2.ok ? await r2.json() : null;
        const v = info && cleanLineId(info.basicId);
        if (v) set.lineId = v;
      } catch { /* ไม่เป็นไร ใส่เองได้ */ }
    }
  }
  await Hotel.findByIdAndUpdate(req.params.id, set);
  res.json({ ok: true, lineId: set.lineId });
});

export default r;
