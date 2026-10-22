import { Router } from "express";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import RoomType from "../models/RoomType.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { notifyBooking, notifyCancel, notifyGuestPaid } from "../lib/notify.js";
import { methodTh } from "../lib/pay.js";
import { usedPeak } from "../lib/availability.js";

const r = Router();

import { mkRef } from "../lib/security.js";

r.get("/hotels/:hid/bookings", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  const since = req.query.since; // "YYYY-MM-DD" optional
  const q = { hotel: req.params.hid };
  if (since) q.checkout = { $gte: since };
  res.json(await Booking.find(q).sort("checkin"));
});

// ฟิลด์การจองที่หลังบ้านแก้ได้ (whitelist + ตรวจค่า) — ย้ายไปโรงแรมอื่น/แก้เลขจอง/ยอดบริการเสริม ฯลฯ ไม่ได้
const BK_CH = ["direct", "walkin", "phone", "line", "agoda", "booking", "trip", "airbnb", "other"];
const BK_STATUS = ["confirmed", "pending", "cancelled"], BK_PAY = ["", "unpaid", "reported", "paid", "deposit", "onsite"], BK_METHOD = ["", "promptpay", "transfer", "onsite", "cash", "ota"];
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
async function cleanBooking(b, hotelId) {
  const set = {};
  for (const [k, n] of [["guestName", 120], ["guestTel", 30], ["guestEmail", 120], ["note", 500], ["payRef", 60]]) if (b[k] !== undefined) set[k] = String(b[k] ?? "").trim().slice(0, n);
  for (const [k, list] of [["channel", BK_CH], ["status", BK_STATUS], ["payStatus", BK_PAY], ["payMethod", BK_METHOD], ["notifyChannel", ["email", "none"]]]) {
    if (b[k] === undefined || (b[k] === "" && !list.includes(""))) continue; // ช่องว่าง = ไม่เปลี่ยน
    if (!list.includes(b[k])) return { error: "ค่า " + k + " ไม่ถูกต้อง" };
    set[k] = b[k];
  }
  for (const k of ["checkin", "checkout"]) if (b[k] !== undefined) { if (!YMD_RE.test(String(b[k]))) return { error: "วันที่ไม่ถูกต้อง (YYYY-MM-DD)" }; set[k] = b[k]; }
  if (b.pax !== undefined) set.pax = Math.round(num(b.pax, 1, 50)) || 1;
  if (b.extraBed !== undefined) set.extraBed = Math.round(num(b.extraBed, 0, 20));
  if (b.amount !== undefined && b.amount !== null) set.amount = Math.round(num(b.amount, 0, 10000000) * 100) / 100;
  if (b.roomType !== undefined) {
    const t = mongoose.isValidObjectId(b.roomType) ? await RoomType.findOne({ _id: b.roomType, hotel: hotelId }) : null;
    if (!t) return { error: "ไม่พบประเภทห้องนี้ในที่พัก" };
    set.roomType = t._id; set._rt = t;
  }
  return { set };
}

r.post("/hotels/:hid/bookings", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  const b = req.body || {};
  if (!b.checkin || !b.checkout || b.checkout <= b.checkin) return res.status(400).json({ error: "invalid dates" });
  const { set, error } = await cleanBooking(b, req.params.hid);
  if (error) return res.status(400).json({ error });
  const t = set._rt; delete set._rt;
  let amount = set.amount;
  if (amount == null && t) {
    const nights = Math.max(1, Math.round((new Date(set.checkout) - new Date(set.checkin)) / 86400000));
    amount = (t.basePrice + (set.extraBed || 0) * (t.extraBedPrice || 0)) * nights;
  }
  const created = await Booking.create({ ...set, amount: amount || 0, hotel: req.params.hid, ref: mkRef() });
  notifyBooking(created._id).catch((e) => console.error("notify", e));
  res.json(created);
});

r.patch("/bookings/:id", requireAuth, async (req, res) => {
  const bk = await Booking.findById(req.params.id);
  if (!bk) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, bk.hotel)) return res.status(403).json({ error: "forbidden" });
  const { set, error } = await cleanBooking(req.body || {}, bk.hotel);
  if (error) return res.status(400).json({ error });
  delete set._rt;
  if ((set.checkout || bk.checkout) <= (set.checkin || bk.checkin)) return res.status(400).json({ error: "invalid dates" });
  const out = await Booking.findByIdAndUpdate(bk._id, { $set: set }, { new: true });
  if (set.payStatus === "paid" && bk.payStatus !== "paid") notifyGuestPaid(bk._id).catch((e) => console.error("notifyGuestPaid", e.message));
  res.json(out);
});

// ===== ที่พักยกเลิกการจอง (เก็บประวัติไว้ ไม่ลบ) — ยกเลิกทุกห้องในเลขจองเดียวกัน + แจ้งแขกทางอีเมล =====
const groupFilter = (bk) => {
  const g = /^(BP-[A-Z0-9]{6})(-\d+)?$/.exec(String(bk.ref || ""));
  return g ? { hotel: bk.hotel, ref: new RegExp("^" + g[1] + "(-\\d+)?$") } : { _id: bk._id };
};
r.post("/bookings/:id/cancel", requireAuth, async (req, res) => {
  const bk = await Booking.findById(req.params.id);
  if (!bk) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, bk.hotel)) return res.status(403).json({ error: "forbidden" });
  const { reason = "", notify = true } = req.body || {};
  const list = await Booking.find({ ...groupFilter(bk), status: { $ne: "cancelled" } }).lean();
  if (!list.length) return res.json({ ok: true, cancelled: 0 });
  await Booking.updateMany({ _id: { $in: list.map((b) => b._id) } }, { $set: { status: "cancelled", cancelReason: "hotel", cancelledAt: new Date() } });
  if (notify !== false) notifyCancel(bk.hotel, list, { by: "hotel", reason: String(reason || "").slice(0, 200) }).catch((e) => console.error("notifyCancel", e.message));
  res.json({ ok: true, cancelled: list.length });
});
// กู้คืนการจองที่ยกเลิกไป (กดพลาด / แขกขอกลับมา) — ได้เฉพาะถ้าห้องช่วงนั้นยังว่างพอ
r.post("/bookings/:id/restore", requireAuth, async (req, res) => {
  const bk = await Booking.findById(req.params.id);
  if (!bk) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, bk.hotel)) return res.status(403).json({ error: "forbidden" });
  const list = await Booking.find({ ...groupFilter(bk), status: "cancelled" }).lean();
  if (!list.length) return res.json({ ok: true, restored: 0 });
  if (bk.roomType) {
    const t = await RoomType.findById(bk.roomType).select("qty").lean();
    const busy = await usedPeak(bk.roomType, bk.checkin, bk.checkout); // คืนที่แน่นที่สุดในช่วง
    if (t && busy + list.length > (t.qty || 1)) return res.status(409).json({ error: "ห้องช่วงวันนั้นถูกจองไปแล้ว กู้คืนไม่ได้ — สร้างการจองใหม่ในวัน/ห้องอื่นแทน" });
  }
  await Booking.updateMany({ _id: { $in: list.map((b) => b._id) } }, { $set: { status: "confirmed", cancelReason: "" }, $unset: { cancelledAt: 1 } });
  res.json({ ok: true, restored: list.length });
});

// ===== ส่งออกการจองเป็นไฟล์ CSV (เปิดใน Excel / Google Sheets ได้ ภาษาไทยไม่เพี้ยน) =====
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const CH_TH = { direct: "จองตรง", walkin: "Walk-in", phone: "โทรจอง", line: "LINE", agoda: "Agoda", booking: "Booking.com", trip: "Trip.com", airbnb: "Airbnb", other: "อื่น ๆ" };
const PAY_TH = { paid: "ชำระแล้ว", reported: "แจ้งโอน รอตรวจ", deposit: "มัดจำ", onsite: "จ่ายที่เคาน์เตอร์", unpaid: "ยังไม่ชำระ", "": "" };
const CX_TH = { guest: "แขกยกเลิก", "auto-unpaid": "ระบบยกเลิก (ไม่ชำระ)", hotel: "ที่พักยกเลิก" };
// กันสูตร Excel แฝง (CSV injection) + ใส่เครื่องหมายคำพูดเมื่อจำเป็น
const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
r.get("/hotels/:hid/bookings/export", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  const from = YMD.test(String(req.query.from || "")) ? req.query.from : "2000-01-01";
  const to = YMD.test(String(req.query.to || "")) ? req.query.to : "2999-12-31";
  const list = await Booking.find({ hotel: req.params.hid, checkin: { $gte: from, $lte: to } }).sort("checkin").lean();
  const rts = await RoomType.find({ hotel: req.params.hid }).select("name").lean();
  const rn = {}; rts.forEach((t) => (rn[String(t._id)] = t.name));
  const nights = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5));
  const head = ["เลขจอง", "สถานะ", "ช่องทาง", "ชื่อแขก", "เบอร์โทร", "อีเมล", "ห้อง", "เช็คอิน", "เช็คเอาท์", "คืน", "จำนวนคน", "เตียงเสริม", "อาหารเช้า", "บริการเสริม", "ส่วนลด", "ยอดรวม", "การชำระ", "ช่องทางชำระ", "อ้างอิงโอน", "คำขอพิเศษ", "จองเมื่อ"];
  const rows = list.map((b) => [
    b.ref, b.status === "cancelled" ? "ยกเลิก" + (CX_TH[b.cancelReason] ? ` (${CX_TH[b.cancelReason]})` : "") : "ยืนยัน", CH_TH[b.channel] || b.channel || "",
    b.guestName, b.guestTel, b.guestEmail, rn[String(b.roomType)] || "", b.checkin, b.checkout, nights(b.checkin, b.checkout), b.pax || "", b.extraBed || "",
    b.breakfast === "included" ? "รวมแล้ว" : b.breakfast === "added" ? `เพิ่ม ${b.breakfastPax || ""} ท่าน (${b.breakfastTotal || 0})${(b.breakfastDates || []).length ? " เช้า " + b.breakfastDates.join(" ") : ""}` : "",
    (b.addons || []).map((a) => `${a.name} x${a.qty}${a.date ? " " + a.date : ""}`).join(" / "), b.discount || "", b.amount || 0,
    PAY_TH[b.payStatus || ""] ?? b.payStatus, methodTh(b.payMethod), b.payRef || "", b.note || "",
    b.createdAt ? new Date(new Date(b.createdAt).getTime() + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "",
  ]);
  const csv = "\uFEFF" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="bookings-${from}-to-${to}.csv"`).send(csv);
});

r.delete("/bookings/:id", requireAuth, async (req, res) => {
  const bk = await Booking.findById(req.params.id);
  if (!bk) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, bk.hotel)) return res.status(403).json({ error: "forbidden" });
  await bk.deleteOne();
  res.json({ ok: true });
});

export default r;
