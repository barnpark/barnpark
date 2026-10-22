import mongoose from "mongoose";

const schema = new mongoose.Schema({
  hotel:         { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  roomType:      { type: mongoose.Schema.Types.ObjectId, ref: "RoomType" },
  guestName:     String,
  guestTel:      String,
  guestEmail:    String,
  channel:       { type: String, default: "direct" }, // direct|walkin|phone|line|agoda|booking|trip|other
  checkin:       { type: String, required: true },     // "YYYY-MM-DD"
  checkout:      { type: String, required: true },
  pax:           { type: Number, default: 1 },
  amount:        { type: Number, default: 0 },
  extraBed:      { type: Number, default: 0 },
  status:        { type: String, default: "confirmed" }, // confirmed|pending|cancelled
  payStatus:     { type: String, default: "" },          // ""|unpaid|reported(แขกแจ้งโอน รอตรวจ)|paid|deposit|onsite(จ่ายที่เคาน์เตอร์ตอนเข้าพัก — ไม่ถูกปล่อยห้องอัตโนมัติ)
  payRef:        String,                                  // เลขอ้างอิง/เวลาโอน ที่แขกกรอกตอนแจ้งชำระ
  payMethod:     { type: String, default: "" },          // promptpay|transfer|cash|ota (วิธีที่แขกเลือก/จ่ายจริง)
  promoCode:     String,                                  // โค้ดส่วนลดที่ใช้
  discount:      { type: Number, default: 0 },            // ส่วนลดต่อห้องนี้ (บาท)
  addons:        { type: [{ name: String, price: Number, qty: Number }], default: [] }, // บริการเสริมที่ซื้อพ่วง
  addonTotal:    { type: Number, default: 0 },            // ยอดบริการเสริมรวม (เก็บที่ห้องแรกของกลุ่ม)
  breakfast:     { type: String, default: "" },           // "" ไม่มี | included รวมในราคาห้อง | added แขกเลือกเพิ่ม
  breakfastPax:  { type: Number, default: 0 },            // จำนวนท่านที่สั่งอาหารเช้าเพิ่ม
  breakfastTotal:{ type: Number, default: 0 },            // ค่าอาหารเช้าที่สั่งเพิ่ม (เก็บที่ห้องแรกของกลุ่ม)
  notifyChannel: { type: String, default: "email" },     // email|none (ส่งใบยืนยันทางอีเมล — ไม่มี SMS)
  lineUserId:    String,
  ref:           String,
  extUid:        String, // รหัสยืนยันจาก OTA (อนาคต Channex)
  note:          String,                                  // คำขอพิเศษจากแขก / เวลาที่จะมาถึง
  lineRemindedAt: Date,                                  // ส่งเตือนก่อนเข้าพักทาง LINE OA ของที่พักแล้ว (กันส่งซ้ำ)
  remindedAt:    Date,                                    // ส่งอีเมลเตือนก่อนเข้าพักแล้ว (กันส่งซ้ำ)
  cancelReason:  String,                                  // guest = แขกยกเลิกเอง · auto-unpaid = ระบบปล่อยห้อง (ไม่ชำระตามเวลา) · hotel = ที่พักยกเลิก
  cancelledAt:   Date,
}, { timestamps: true });

schema.index({ hotel: 1, checkin: 1, checkout: 1 });

export default mongoose.model("Booking", schema);
