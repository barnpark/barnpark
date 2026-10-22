// ===== สำรองข้อมูล: ไฟล์ JSON ทั้งระบบ (ปุ่มดาวน์โหลดในหน้าแอดมิน) + สำรองอัตโนมัติรายวันขึ้น Supabase (bucket ส่วนตัว) =====
//   ไฟล์รายวัน: daily/YYYY-MM-DD.json.gz (วันที่เวลาไทย) · เก็บ 30 ไฟล์ล่าสุด ไฟล์เก่ากว่านั้นลบทิ้ง
//   ไม่มีความลับในไฟล์: ตัด passwordHash / otpHash / resetHash / token-secret ของ LINE ออกเสมอ
import { gzip } from "zlib";
import { promisify } from "util";
import Hotel from "../models/Hotel.js";
import User from "../models/User.js";
import RoomType from "../models/RoomType.js";
import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import ActivityBooking from "../models/ActivityBooking.js";
import Feedback from "../models/Feedback.js";
import PromoCode from "../models/PromoCode.js";
import Review from "../models/Review.js";
import { storeReady, backupBucket, putObject, listObjects, removePaths, signedUrl } from "./filestore.js";

export const KEEP_BACKUPS = 30;
const SECRET = ["passwordHash", "otpHash", "resetHash", "lineChannelToken", "lineChannelSecret"];
const strip = (rows) => rows.map((d) => { for (const k of SECRET) delete d[k]; return d; });
const NAME = /^\d{4}-\d{2}-\d{2}\.json\.gz$/;
const dayTH = (d = new Date()) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);

// ข้อมูลทั้งระบบ — ชุดเดียวกับ GET /api/admin/export · full = เพิ่มโค้ดส่วนลด + รีวิว (ใช้ในไฟล์สำรองรายวัน)
export async function exportData({ full = false } = {}) {
  const [hotels, users, rooms, bookings, services, activityBookings, feedback, promoCodes, reviews] = await Promise.all([
    Hotel.find().lean(), User.find().select("-passwordHash -otpHash").lean(),
    RoomType.find().lean(), Booking.find().lean(), Service.find().lean(), ActivityBooking.find().lean(), Feedback.find().lean(),
    full ? PromoCode.find().lean() : null, full ? Review.find().lean() : null,
  ]);
  const out = { exportedAt: new Date().toISOString(), hotels: strip(hotels), users: strip(users), rooms, bookings, services, activityBookings, feedback };
  if (full) Object.assign(out, { promoCodes, reviews });
  return out;
}

// สำรองตอนนี้ → { ok, path, bytes, rawBytes, removed } · ยังไม่ตั้ง Supabase → { skipped }
export async function runBackup({ now = new Date() } = {}) {
  if (!storeReady()) return { skipped: "ยังไม่ได้ตั้งค่า Supabase — ไม่ได้สำรองอัตโนมัติ" };
  const raw = Buffer.from(JSON.stringify(await exportData({ full: true })));
  const gz = await promisify(gzip)(raw);
  const path = "daily/" + dayTH(now) + ".json.gz";
  await putObject(backupBucket(), path, gz, "application/gzip"); // วันเดียวกันสำรองซ้ำ = เขียนทับไฟล์ของวันนั้น
  let removed = 0;
  try {
    const names = (await listObjects(backupBucket(), "daily")).map((f) => f.name).filter((n) => NAME.test(n)).sort();
    const old = names.slice(0, Math.max(0, names.length - KEEP_BACKUPS));
    if (old.length) removed = await removePaths(backupBucket(), old.map((n) => "daily/" + n));
  } catch (e) { console.warn("backup retention:", e.message); }
  console.log("backup saved", path, gz.length, "bytes");
  return { ok: true, path, bytes: gz.length, rawBytes: raw.length, removed };
}

// ไฟล์สำรองล่าสุดก่อน
export async function listBackups() {
  return (await listObjects(backupBucket(), "daily")).filter((f) => NAME.test(f.name)).sort((a, b) => (a.name < b.name ? 1 : -1));
}
// ลิงก์ดาวน์โหลดชั่วคราว 5 นาที
export async function backupLink(name) {
  if (!NAME.test(String(name || ""))) throw Object.assign(new Error("ชื่อไฟล์สำรองไม่ถูกต้อง"), { status: 400 });
  return signedUrl(backupBucket(), "daily/" + name, 300);
}
