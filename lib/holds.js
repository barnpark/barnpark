// ปล่อยห้องที่ "จองค้างไม่จ่าย" อัตโนมัติ ตาม holdHours ของแต่ละโรงแรม
// ยกเลิกเฉพาะการจองตรง (direct) ที่ payStatus = "unpaid" เท่านั้น
// (ไม่แตะ reported/paid และไม่แตะการจองที่พนักงานคีย์มือซึ่ง payStatus ว่าง)
import Hotel from "../models/Hotel.js";
import Booking from "../models/Booking.js";

export async function releaseExpiredHolds() {
  const hotels = await Hotel.find({ holdHours: { $gt: 0 } }).select("_id holdHours");
  const today = new Date().toISOString().slice(0, 10);
  let total = 0;
  for (const h of hotels) {
    const cutoff = new Date(Date.now() - h.holdHours * 3600 * 1000);
    const res = await Booking.updateMany(
      { hotel: h._id, channel: "direct", payStatus: "unpaid", status: "confirmed",
        createdAt: { $lt: cutoff }, checkout: { $gt: today } },
      { $set: { status: "cancelled", note: "ยกเลิกอัตโนมัติ: ไม่ชำระภายในเวลาที่กำหนด" } }
    );
    total += res.modifiedCount || 0;
  }
  if (total) console.log(`[holds] auto-released ${total} unpaid booking(s)`);
  return total;
}
