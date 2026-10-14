// ปล่อยห้องที่ "จองค้างไม่จ่าย" อัตโนมัติ ตาม holdHours ของแต่ละโรงแรม
// ยกเลิกเฉพาะการจองตรง (direct) ที่ payStatus = "unpaid" เท่านั้น
// (ไม่แตะ reported/paid/onsite และไม่แตะการจองที่พนักงานคีย์มือซึ่ง payStatus ว่าง)
// ยกเลิกแล้วแจ้งโรงแรม (LINE/อีเมล) + แจ้งแขกทางอีเมล — ไม่ทับ "คำขอพิเศษ" ของแขก
import Hotel from "../models/Hotel.js";
import Booking from "../models/Booking.js";
import { notifyCancel } from "./notify.js";

export async function releaseExpiredHolds() {
  const hotels = await Hotel.find({ holdHours: { $gt: 0 } }).select("_id holdHours");
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  let total = 0;
  for (const h of hotels) {
    const cutoff = new Date(Date.now() - h.holdHours * 3600 * 1000);
    // เฉพาะการจองที่ยังไม่ถึงวันเช็คอิน (ถึงวันแล้ว = แขกกำลังมา/มาแล้ว ให้ที่พักเก็บเงินหน้างาน)
    const q = { hotel: h._id, channel: "direct", payStatus: "unpaid", status: "confirmed", createdAt: { $lt: cutoff }, checkin: { $gt: today } };
    const list = await Booking.find(q).lean();
    if (!list.length) continue;
    const res = await Booking.updateMany({ ...q, _id: { $in: list.map((b) => b._id) } }, { $set: { status: "cancelled", cancelReason: "auto-unpaid" } });
    total += res.modifiedCount || 0;
    // แจ้งทีละเลขจอง (รวมหลายห้องในเลขเดียวกัน)
    const groups = {};
    for (const b of list) (groups[String(b.ref || b._id).replace(/-\d+$/, "")] ||= []).push(b);
    for (const g of Object.values(groups)) await notifyCancel(h._id, g, { by: "auto" }).catch((e) => console.error("holds notify", e.message));
  }
  if (total) console.log(`[holds] auto-released ${total} unpaid booking(s)`);
  return total;
}
