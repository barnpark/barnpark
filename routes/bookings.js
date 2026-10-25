import { Router } from "express";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { receiptUrl } from "../lib/receipt.js";
import { notifyBooking, notifyCancel, notifyGuestPaid } from "../lib/notify.js";
import { methodTh } from "../lib/pay.js";
import { usedPeak } from "../lib/availability.js";
import { stayAction, STAY_TH, normRoomNo } from "../lib/frontdesk.js";
import { actor, logAction, moneyView, maskMoney, seesMoney } from "../lib/team.js";

const r = Router();

import { mkRef } from "../lib/security.js";

r.get("/hotels/:hid/bookings", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  const since = req.query.since; // "YYYY-MM-DD" optional
  const q = { hotel: req.params.hid };
  if (since) q.checkout = { $gte: since };
  const full = await moneyView(req, res, req.params.hid); if (full === null) return;
  const list = await Booking.find(q).sort("checkin");
  res.json(full ? list : list.map(maskMoney));
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
  const who = await actor(req, res, req.params.hid, "bookings"); if (!who) return;
  const created = await Booking.create({ ...set, amount: amount || 0, hotel: req.params.hid, ref: mkRef(), createdBy: who.name });
  await logAction(req.params.hid, who, "booking.create", created.ref, `${created.guestName || ""} ${created.checkin} → ${created.checkout}`);
  notifyBooking(created._id).catch((e) => console.error("notify", e));
  res.json(seesMoney(who) ? created : maskMoney(created));
});

r.patch("/bookings/:id", requireAuth, async (req, res) => {
  const bk = await Booking.findById(req.params.id);
  if (!bk) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, bk.hotel)) return res.status(403).json({ error: "forbidden" });
  const { set, error } = await cleanBooking(req.body || {}, bk.hotel);
  if (error) return res.status(400).json({ error });
  delete set._rt;
  if ((set.checkout || bk.checkout) <= (set.checkin || bk.checkin)) return res.status(400).json({ error: "invalid dates" });
  // แค่ยืนยันรับเงิน (เช่น ตอนเช็คเอาท์) = สิทธิ์การจอง หรือ หน้าเคาน์เตอร์ · แก้อย่างอื่น = สิทธิ์การจอง
  const payOnly = Object.keys(set).every((k) => ["payStatus", "payMethod", "payRef"].includes(k));
  const who = await actor(req, res, bk.hotel, payOnly ? ["bookings", "desk"] : "bookings"); if (!who) return;
  const paidNow = set.payStatus === "paid" && bk.payStatus !== "paid";
  if (paidNow) set.paidBy = who.name;
  const out = await Booking.findByIdAndUpdate(bk._id, { $set: set }, { new: true });
  const PAY = ["payStatus", "payMethod", "payRef", "paidBy"];
  const changed = Object.keys(set).filter((k) => !(paidNow ? PAY : ["paidBy"]).includes(k) && String(set[k]) !== String(bk[k] ?? ""));
  if (paidNow) await logAction(bk.hotel, who, "booking.paid", bk.ref, `${bk.guestName || ""} ฿${bk.amount || 0}`);
  if (changed.some((k) => k !== "payStatus")) await logAction(bk.hotel, who, "booking.edit", bk.ref, changed.join(", "));
  if (set.payStatus === "paid" && bk.payStatus !== "paid") notifyGuestPaid(bk._id).catch((e) => console.error("notifyGuestPaid", e.message));
  res.json(seesMoney(who) ? out : maskMoney(out));
});

// ===== หน้าเคาน์เตอร์: ให้เลขห้อง · เช็คอิน · เช็คเอาท์ · ไม่มา · ย้อนกลับ (lib/frontdesk.js) =====
const todayTH = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
r.post("/bookings/:id/stay", requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "not found" });
  const bk = await Booking.findById(req.params.id).lean();
  if (!bk) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, bk.hotel)) return res.status(403).json({ error: "forbidden" });
  const action = String(req.body?.action || ""), roomNo = req.body?.roomNo;
  const rt = bk.roomType ? await RoomType.findById(bk.roomType).select("qty units").lean() : null;
  const others = roomNo ? await Booking.find({ hotel: bk.hotel, roomNo: normRoomNo(roomNo), _id: { $ne: bk._id }, checkin: { $lt: bk.checkout }, checkout: { $gt: bk.checkin } }).select("guestName checkin checkout roomNo status stay").lean() : [];
  const out = stayAction(bk, action, { roomNo, today: todayTH(), units: (rt && rt.units) || [], others });
  if (out.error) return res.status(400).json({ error: out.error });
  // ย้อน “ไม่มา” = กลับมานับห้อง → ต้องยังมีห้องว่างพอ (อาจขายคืนที่เหลือไปแล้ว)
  if (action === "undo" && bk.stay === "noshow" && rt) {
    const from = bk.checkin > todayTH() ? bk.checkin : todayTH();
    if (from < bk.checkout && (await usedPeak(bk.roomType, from, bk.checkout)) + 1 > (rt.qty || 1)) return res.status(409).json({ error: "ห้องช่วงนั้นถูกจองไปแล้ว ย้อนไม่ได้" });
  }
  const who = await actor(req, res, bk.hotel, "desk"); if (!who) return;
  if (action === "in") out.set.checkedInBy = who.name;
  if (action === "out") out.set.checkedOutBy = who.name;
  const upd = { $set: out.set };
  if (out.unset) upd.$unset = out.unset;
  const saved = await Booking.findByIdAndUpdate(bk._id, upd, { new: true });
  await logAction(bk.hotel, who, "stay." + action, bk.ref, [bk.guestName, out.set.roomNo || bk.roomNo ? "ห้อง " + (out.set.roomNo || bk.roomNo) : ""].filter(Boolean).join(" · "));
  if (out.dirty && rt) await RoomType.updateOne({ _id: rt._id, "units.no": out.dirty }, { $set: { "units.$.hk": "dirty" } });
  res.json(seesMoney(who) ? saved : maskMoney(saved));
});

// ===== ที่พักยกเลิกการจอง (เก็บประวัติไว้ ไม่ลบ) — ยกเลิกทุกห้องในเลขจองเดียวกัน + แจ้งแขกทางอีเมล =====
const groupFilter = (bk) => {
  const g = /^(BP-[A-Z0-9]{6})(-\d+)?$/.exec(String(bk.ref || ""));
  return g ? { hotel: bk.hotel, ref: new RegExp("^" + g[1] + "(-\\d+)?$") } : { _id: bk._id };
};
// ลิงก์ใบเสร็จของการจองนี้ (เว็บหลังบ้าน → ปุ่ม 🧾 ใบเสร็จ)
r.get("/bookings/:id/receipt-link", requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "not found" });
  const bk = await Booking.findById(req.params.id).select("hotel ref").lean();
  if (!bk) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, bk.hotel)) return res.status(403).json({ error: "forbidden" });
  const h = await Hotel.findById(bk.hotel).select("slug").lean();
  const url = h && receiptUrl(h, bk.ref);
  if (!url) return res.status(400).json({ error: "ยังออกลิงก์ใบเสร็จไม่ได้ (ต้องตั้ง JWT_SECRET ใน Render)" });
  res.json({ url });
});
r.post("/bookings/:id/cancel", requireAuth, async (req, res) => {
  const bk = await Booking.findById(req.params.id);
  if (!bk) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, bk.hotel)) return res.status(403).json({ error: "forbidden" });
  const { reason = "", notify = true } = req.body || {};
  const list = await Booking.find({ ...groupFilter(bk), status: { $ne: "cancelled" } }).lean();
  if (!list.length) return res.json({ ok: true, cancelled: 0 });
  const who = await actor(req, res, bk.hotel, "bookings"); if (!who) return;
  await Booking.updateMany({ _id: { $in: list.map((b) => b._id) } }, { $set: { status: "cancelled", cancelReason: "hotel", cancelledAt: new Date(), cancelledBy: who.name } });
  await logAction(bk.hotel, who, "booking.cancel", String(bk.ref || "").replace(/-\d+$/, ""), [bk.guestName, String(reason || "").slice(0, 100)].filter(Boolean).join(" · "));
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
  const who = await actor(req, res, bk.hotel, "bookings"); if (!who) return;
  await Booking.updateMany({ _id: { $in: list.map((b) => b._id) } }, { $set: { status: "confirmed", cancelReason: "" }, $unset: { cancelledAt: 1, cancelledBy: 1 } });
  await logAction(bk.hotel, who, "booking.restore", String(bk.ref || "").replace(/-\d+$/, ""), bk.guestName);
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
  const who = await actor(req, res, req.params.hid, "reports"); if (!who) return; // ข้อมูลแขก + ยอดเงินทั้งหมด → สิทธิ์รายงาน
  await logAction(req.params.hid, who, "booking.export", "", `${from} → ${to}`);
  const list = await Booking.find({ hotel: req.params.hid, checkin: { $gte: from, $lte: to } }).sort("checkin").lean();
  const rts = await RoomType.find({ hotel: req.params.hid }).select("name").lean();
  const rn = {}; rts.forEach((t) => (rn[String(t._id)] = t.name));
  const nights = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5));
  const head = ["เลขจอง", "สถานะ", "ช่องทาง", "ชื่อแขก", "เบอร์โทร", "อีเมล", "ห้อง", "เช็คอิน", "เช็คเอาท์", "คืน", "จำนวนคน", "เตียงเสริม", "อาหารเช้า", "บริการเสริม", "ส่วนลด", "ยอดรวม", "การชำระ", "ช่องทางชำระ", "อ้างอิงโอน", "คำขอพิเศษ", "จองเมื่อ", "เลขห้อง", "สถานะเข้าพัก"];
  const rows = list.map((b) => [
    b.ref, b.status === "cancelled" ? "ยกเลิก" + (CX_TH[b.cancelReason] ? ` (${CX_TH[b.cancelReason]})` : "") : "ยืนยัน", CH_TH[b.channel] || b.channel || "",
    b.guestName, b.guestTel, b.guestEmail, rn[String(b.roomType)] || "", b.checkin, b.checkout, nights(b.checkin, b.checkout), b.pax || "", b.extraBed || "",
    b.breakfast === "included" ? "รวมแล้ว" : b.breakfast === "added" ? `เพิ่ม ${b.breakfastPax || ""} ท่าน (${b.breakfastTotal || 0})${(b.breakfastDates || []).length ? " เช้า " + b.breakfastDates.join(" ") : ""}` : "",
    (b.addons || []).map((a) => `${a.name} x${a.qty}${a.date ? " " + a.date : ""}`).join(" / "), b.discount || "", b.amount || 0,
    PAY_TH[b.payStatus || ""] ?? b.payStatus, methodTh(b.payMethod), b.payRef || "", b.note || "",
    b.createdAt ? new Date(new Date(b.createdAt).getTime() + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "",
    b.roomNo || "", b.status === "cancelled" ? "" : STAY_TH[b.stay || ""] || "",
  ]);
  const csv = "\uFEFF" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="bookings-${from}-to-${to}.csv"`).send(csv);
});

r.delete("/bookings/:id", requireAuth, async (req, res) => {
  const bk = await Booking.findById(req.params.id);
  if (!bk) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, bk.hotel)) return res.status(403).json({ error: "forbidden" });
  const who = await actor(req, res, bk.hotel, "bookings"); if (!who) return;
  await bk.deleteOne();
  await logAction(bk.hotel, who, "booking.delete", bk.ref, `${bk.guestName || ""} ${bk.checkin} → ${bk.checkout}`);
  res.json({ ok: true });
});

export default r;
