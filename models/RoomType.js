import mongoose from "mongoose";
import { bumpMapOnChange } from "../lib/mapcache.js";

const schema = new mongoose.Schema({
  hotel:         { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  name:          String,
  description:   String,                 // คำอธิบายสั้น ๆ (แสดงบนการ์ดห้อง)
  amenities:     { type: [String], default: [] }, // สิ่งอำนวยความสะดวกในห้อง (แอร์ Wi-Fi ฯลฯ + พิมพ์เพิ่มเอง)
  hidden:        { type: Boolean, default: false }, // ปิดขายชั่วคราว (ไม่แสดงบนหน้าจอง)
  capacity:      { type: Number, default: 2 },
  qty:           { type: Number, default: 1 },
  basePrice:     { type: Number, default: 0 },
  otaPrice:      { type: Number, default: 0 },
  extraBedPrice: { type: Number, default: 0 },
  // อาหารเช้า: none = ไม่มี · included = รวมในราคาห้องแล้ว · optional = แขกเลือกเพิ่มได้ (คิดราคาต่อท่าน/คืน)
  // ไม่ตั้ง default ไว้ เพื่อแยก "ยังไม่ได้ระบุ" ออกจาก "ไม่มีอาหารเช้า" (ใช้ในเช็กความครบ)
  breakfast:      { type: String },
  breakfastPrice: { type: Number, default: 0 },
  imageUrl:      String,                 // รูปหลัก (เท่ากับ images[0]) — เก็บไว้เพื่อความเข้ากันได้
  images:        { type: [String], default: [] }, // แกลเลอรีสูงสุด 4 รูป
  // ราคาตามฤดู/ช่วงพิเศษ — ใช้ราคาของช่วงที่ "วันเช็คอิน" ตกอยู่ (ถ้าไม่ตกช่วงไหน ใช้ basePrice)
  seasons:       { type: [{ name: String, from: String, to: String, price: Number, minNights: Number }], default: [] },
  sort:          { type: Number, default: 0 },
  // เลขห้องจริง (หน้าเคาน์เตอร์) + สถานะทำความสะอาด clean|dirty|inspected|ooo — ไม่ใส่ก็ได้ (ห้องว่างนับจาก qty)
  units:         { type: [{ _id: false, no: String, hk: { type: String, default: "clean" } }], default: [] },
}, { timestamps: true });

bumpMapOnChange(schema, []); // แผนที่หน้าแรกอัปเดตทันทีเมื่อห้อง/ราคาเปลี่ยน (lib/mapcache.js)
export default mongoose.model("RoomType", schema);
