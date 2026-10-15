// ===== อาหารเช้า + ข้อมูลการเข้าพัก — ใช้ร่วมกันทั้งหน้าเว็บ อีเมล และ LINE =====
import { normTime } from "./activity.js";

export const BF_MODES = ["none", "included", "optional"];
export const LEGACY_BF = "🍳 รวมอาหารเช้า"; // ชิปเดิมในสิ่งอำนวยฯ (ก่อนมีช่องอาหารเช้าจริง)

// โหมดอาหารเช้าของห้อง: none = ไม่มี · included = รวมในราคาห้อง · optional = แขกเลือกเพิ่ม (ราคาต่อท่าน/คืน)
export function breakfastOf(t = {}) {
  const explicit = BF_MODES.includes(t.breakfast);
  let mode = explicit ? t.breakfast : (t.amenities || []).includes(LEGACY_BF) ? "included" : "none";
  const price = Math.max(0, Math.round(Number(t.breakfastPrice) || 0));
  if (mode === "optional" && !price) mode = "none"; // เลือกเพิ่มแต่ไม่มีราคา → ไม่ขาย
  return { mode, price, explicit };
}
export const bfText = (bf) =>
  bf.mode === "included" ? "รวมอาหารเช้า" : bf.mode === "optional" ? `เพิ่มอาหารเช้าได้ ฿${bf.price.toLocaleString("en-US")}/ท่าน/คืน` : "ไม่รวมอาหารเช้า";

// สิ่งอำนวยฯ ที่แสดง — ตัดชิปอาหารเช้าเดิมออกเมื่อเจ้าของตั้งอาหารเช้าแบบใหม่แล้ว (กันข้อมูลขัดกัน)
export const roomAmenities = (t = {}) => (t.amenities || []).filter((a) => a !== LEGACY_BF || !BF_MODES.includes(t.breakfast));

// ค่าที่รับจากเว็บ/LINE → ค่าที่บันทึก (null = ไม่ถูกต้อง)
export function cleanBreakfast(mode, price) {
  if (!BF_MODES.includes(mode)) return null;
  const p = Math.round(Number(price) || 0);
  if (mode === "optional" && !(p > 0 && p <= 100000)) return null;
  return { breakfast: mode, breakfastPrice: mode === "optional" ? p : 0 };
}

// ===== ข้อมูลการเข้าพัก =====
const MAP_RE = /^https:\/\/[^\s"'<>\\]{4,600}$/i;
export const safeMapUrl = (u) => { const s = String(u || "").trim(); return MAP_RE.test(s) ? s : ""; };
export const mapFromLatLng = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
// รับได้ทั้งลิงก์ (ข้อความแชร์จาก Google Maps ที่มีชื่อสถานที่นำหน้า) และพิกัด "13.75, 100.50"
export function mapFromText(t) {
  const s = String(t || "").trim();
  const ll = /^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/.exec(s);
  if (ll && Math.abs(+ll[1]) <= 90 && Math.abs(+ll[2]) <= 180) return mapFromLatLng(ll[1], ll[2]);
  return safeMapUrl((s.match(/https:\/\/[^\s"'<>\\]+/) || [])[0]);
}

// ===== LINE ของที่พัก (ให้แขกกดทักแชท) — รับได้ทั้ง @ID และลิงก์ lin.ee / line.me =====
const LINE_HOSTS = /^(lin\.ee|line\.me|page\.line\.me|liff\.line\.me)$/i;
// ค่าที่เจ้าของพิมพ์ → ค่าที่บันทึก ("" = ล้าง, null = ไม่ถูกต้อง)
export function cleanLineId(v) {
  let s = String(v ?? "").trim();
  if (!s) return "";
  if (/^(lin\.ee|line\.me|page\.line\.me)\//i.test(s)) s = "https://" + s;
  if (/^https?:\/\//i.test(s)) {
    if (s.length > 200 || /["'<>\\\s]/.test(s)) return null;
    try { const u = new URL(s.replace(/^http:/i, "https:")); return LINE_HOSTS.test(u.hostname) ? u.toString() : null; } catch { return null; }
  }
  s = s.replace(/^LINE\s*:?\s*/i, "").replace(/\s+/g, "");
  return /^@?[\w.-]{2,40}$/.test(s) ? s : null;
}
// ลิงก์สำหรับปุ่ม "แชท LINE" ("" ถ้าไม่มี/ไม่ถูกต้อง)
export function lineContactUrl(v) {
  const s = cleanLineId(v);
  if (!s) return "";
  if (/^https:\/\//.test(s)) return s;
  return s[0] === "@" ? "https://line.me/R/ti/p/" + encodeURIComponent(s) : "https://line.me/ti/p/~" + encodeURIComponent(s);
}
// ข้อความที่แสดง เช่น "@baanbaan" (ถ้าเป็นลิงก์ → "LINE")
export const lineLabel = (v) => { const s = cleanLineId(v); return !s ? "" : /^https:\/\//.test(s) ? "LINE" : s; };

export function stayInfo(h = {}) {
  return {
    checkInTime: normTime(h.checkInTime) || "",
    checkOutTime: normTime(h.checkOutTime) || "",
    mapUrl: safeMapUrl(h.mapUrl),
    houseRules: String(h.houseRules || "").slice(0, 2000),
    address: String(h.address || ""),
  };
}

// ตรวจ/ทำความสะอาดฟิลด์ข้อมูลการเข้าพักใน body ของ PATCH /hotels — คืนข้อความ error หรือ null
export function cleanStayFields(body) {
  for (const k of ["checkInTime", "checkOutTime"]) {
    if (body[k] === undefined) continue;
    if (body[k] === "" || body[k] === null) { body[k] = ""; continue; }
    const t = normTime(body[k]);
    if (!t) return "เวลาไม่ถูกต้อง (ใช้รูปแบบ 14:00)";
    body[k] = t;
  }
  if (body.mapUrl !== undefined && body.mapUrl !== "") {
    const u = mapFromText(body.mapUrl);
    if (!u) return "ลิงก์แผนที่ไม่ถูกต้อง (วางลิงก์ https จาก Google Maps)";
    body.mapUrl = u;
  }
  if (body.houseRules !== undefined) body.houseRules = String(body.houseRules || "").slice(0, 2000);
  if (body.address !== undefined) body.address = String(body.address || "").slice(0, 300);
  return null;
}
