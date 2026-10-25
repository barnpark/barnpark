import { Router } from "express";
import ActivityBooking from "../models/ActivityBooking.js";
import Service from "../models/Service.js";
import Hotel from "../models/Hotel.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { actor, logAction, moneyView, maskMoney, seesMoney } from "../lib/team.js";
import { createActivityBooking } from "../lib/activity.js";
import { notifyGuestPaid } from "../lib/notify.js";
import { receiptUrl } from "../lib/receipt.js";

const r = Router();

// การจองกิจกรรมเดี่ยวของโรงแรม (ตั้งแต่วันที่ since)
r.get("/hotels/:hid/activity-bookings", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  const q = { hotel: req.params.hid };
  if (req.query.since) q.date = { $gte: String(req.query.since) };
  const full = await moneyView(req, res, req.params.hid); if (full === null) return;
  const list = await ActivityBooking.find(q).sort({ date: 1, time: 1 }).limit(500);
  res.json(full ? list : list.map(maskMoney));
});
// เจ้าของบันทึกการจองกิจกรรมเอง (walk-in/โทร)
r.post("/hotels/:hid/activity-bookings", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  const h = await Hotel.findById(req.params.hid);
  const svc = await Service.findOne({ _id: req.body.serviceId, hotel: req.params.hid });
  if (!h || !svc) return res.status(404).json({ error: "ไม่พบกิจกรรม" });
  const who = await actor(req, res, req.params.hid, "services"); if (!who) return;
  try { const ab = await createActivityBooking(h, svc, { ...req.body, channel: ["direct", "walkin", "phone", "line", "other"].includes(req.body.channel) ? req.body.channel : "walkin", payStatus: ["unpaid", "reported", "paid", "onsite"].includes(req.body.payStatus) ? req.body.payStatus : "unpaid", note: String(req.body.note || "").slice(0, 300), payRef: String(req.body.payRef || "").slice(0, 60) });
    await logAction(req.params.hid, who, "activity.create", ab && ab.ref, `${svc.name} · ${req.body.guestName || ""}`); res.json(ab); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
r.patch("/activity-bookings/:id", requireAuth, async (req, res) => {
  const b = await ActivityBooking.findById(req.params.id);
  if (!b) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, b.hotel)) return res.status(403).json({ error: "forbidden" });
  const b2 = req.body || {}, set = {};
  if (b2.payStatus !== undefined) { if (!["unpaid", "reported", "paid", "onsite"].includes(b2.payStatus)) return res.status(400).json({ error: "สถานะการชำระไม่ถูกต้อง" }); set.payStatus = b2.payStatus; }
  if (b2.status !== undefined) { if (!["confirmed", "cancelled"].includes(b2.status)) return res.status(400).json({ error: "สถานะไม่ถูกต้อง" }); set.status = b2.status; }
  for (const [k, n] of [["note", 300], ["guestName", 120], ["guestTel", 30]]) if (b2[k] !== undefined) set[k] = String(b2[k] ?? "").trim().slice(0, n);
  const who = await actor(req, res, b.hotel, "services"); if (!who) return;
  const out = await ActivityBooking.findByIdAndUpdate(b._id, { $set: set }, { new: true });
  await logAction(b.hotel, who, set.payStatus === "paid" && b.payStatus !== "paid" ? "booking.paid" : "activity.edit", b.ref, Object.keys(set).join(", "));
  if (set.payStatus === "paid" && b.payStatus !== "paid") notifyGuestPaid(b._id, "act").catch((e) => console.error("notifyGuestPaid", e.message));
  res.json(seesMoney(who) ? out : maskMoney(out));
});
// ลิงก์ใบเสร็จของการจองกิจกรรม (เว็บหลังบ้าน → ปุ่ม 🧾 ใบเสร็จ)
r.get("/activity-bookings/:id/receipt-link", requireAuth, async (req, res) => {
  if (!/^[a-f0-9]{24}$/i.test(String(req.params.id))) return res.status(404).json({ error: "not found" });
  const b = await ActivityBooking.findById(req.params.id).select("hotel ref").lean();
  if (!b) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, b.hotel)) return res.status(403).json({ error: "forbidden" });
  const h = await Hotel.findById(b.hotel).select("slug").lean();
  const url = h && receiptUrl(h, b.ref);
  if (!url) return res.status(400).json({ error: "ยังออกลิงก์ใบเสร็จไม่ได้ (ต้องตั้ง JWT_SECRET ใน Render)" });
  res.json({ url });
});
r.delete("/activity-bookings/:id", requireAuth, async (req, res) => {
  const b = await ActivityBooking.findById(req.params.id);
  if (!b) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, b.hotel)) return res.status(403).json({ error: "forbidden" });
  const who = await actor(req, res, b.hotel, "services"); if (!who) return;
  await b.deleteOne();
  await logAction(b.hotel, who, "activity.delete", b.ref, b.guestName);
  res.json({ ok: true });
});

export default r;
