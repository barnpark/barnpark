// ===== พิกัดของที่พัก (แผนที่หน้าแรก Barn Park) =====
// อ่านจากลิงก์ Google Maps ที่ที่พักใส่ไว้ (Hotel.mapUrl — ใส่เองในเว็บหลังบ้าน หรือส่งตำแหน่งผ่าน LINE)
// ลิงก์ย่อ (maps.app.goo.gl / goo.gl/maps) ตามไปหาลิงก์เต็มครั้งเดียวแล้วจำไว้ (Hotel.geo + geoFrom)
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";

const okLat = (v) => Number.isFinite(v) && Math.abs(v) <= 90, okLng = (v) => Number.isFinite(v) && Math.abs(v) <= 180;
const pair = (a, b) => { const lat = Number(a), lng = Number(b); return okLat(lat) && okLng(lng) && (lat || lng) ? { lat: +lat.toFixed(6), lng: +lng.toFixed(6) } : null; };

// พิกัดจากลิงก์แผนที่: !3dLAT!4dLNG (ตำแหน่งหมุดจริง) > @LAT,LNG > query=/q=/ll=/destination=LAT,LNG
export function latLngFromUrl(url) {
  let s = String(url || "");
  try { s = decodeURIComponent(s); } catch {}
  let m;
  if ((m = /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(s))) return pair(m[1], m[2]);
  if ((m = /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(s))) return pair(m[1], m[2]);
  if ((m = /[?&](?:query|q|ll|destination|center)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(s))) return pair(m[1], m[2]);
  return null;
}

const SHORT_RE = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i;
const GOOGLE_RE = /^https:\/\/([a-z0-9-]+\.)*(google\.[a-z.]+|goo\.gl)\//i;
// ตามลิงก์ย่อของ Google Maps (ไม่เกิน 4 ทอด · ไปได้เฉพาะโดเมน Google) → ลิงก์เต็มที่มีพิกัด · ไม่ได้ = ""
export async function expandShortMapUrl(url) {
  let cur = String(url || "");
  if (!SHORT_RE.test(cur)) return cur;
  for (let i = 0; i < 4; i++) {
    let r;
    try { r = await fetch(cur, { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { "user-agent": "Mozilla/5.0 (BarnPark map)" } }); }
    catch { return ""; }
    const loc = r.headers.get("location");
    if (!loc) return cur;
    cur = new URL(loc, cur).toString();
    if (!GOOGLE_RE.test(cur)) return "";
    if (latLngFromUrl(cur)) return cur;
  }
  return cur;
}

// พิกัดของที่พัก — คำนวณใหม่เมื่อ mapUrl เปลี่ยน (เทียบกับ geoFrom) · ลิงก์ย่อตามไปหาได้ไม่เกิน `budget` ลิงก์ต่อครั้ง
async function geoOf(h, budget) {
  const url = String(h.mapUrl || "");
  if (h.geoFrom === url) return h.geo && okLat(h.geo.lat) ? h.geo : null;
  let g = latLngFromUrl(url);
  if (!g && SHORT_RE.test(url)) {
    if (budget.n <= 0) return null; // ครั้งหน้าค่อยตามต่อ
    budget.n--;
    g = latLngFromUrl(await expandShortMapUrl(url));
  }
  await Hotel.updateOne({ _id: h._id }, { $set: { geo: g || null, geoFrom: url } }).catch(() => {});
  return g;
}

// รายการที่พักบนแผนที่ (หน้าแรก) — เฉพาะที่อนุมัติแล้ว ไม่ได้พักการใช้งาน และไม่ได้ปิดการแสดงบนแผนที่
let cache = { at: 0, data: null };
export async function hotelsForMap({ fresh = false } = {}) {
  if (!fresh && cache.data && Date.now() - cache.at < 5 * 60e3) return cache.data;
  const hotels = await Hotel.find({ approved: { $ne: false }, status: { $ne: "paused" }, onMap: { $ne: false } })
    .select("name slug location tagline mapUrl geo geoFrom coverUrl updatedAt").sort("name").lean();
  const ids = hotels.map((h) => h._id);
  const rooms = ids.length ? await RoomType.find({ hotel: { $in: ids }, hidden: { $ne: true }, basePrice: { $gt: 0 } }).select("hotel basePrice").lean() : [];
  const from = {};
  for (const r of rooms) { const k = String(r.hotel); from[k] = Math.min(from[k] ?? Infinity, r.basePrice); }
  const budget = { n: 3 };
  const out = [];
  for (const h of hotels) {
    const g = await geoOf(h, budget);
    const cover = /^https:\/\//.test(h.coverUrl || "") || /^\/api\/public\/img\/cover\//.test(h.coverUrl || "") ? h.coverUrl : "";
    out.push({
      name: h.name || "", slug: h.slug, location: String(h.location || "").slice(0, 80), tagline: String(h.tagline || "").slice(0, 120),
      lat: g ? g.lat : null, lng: g ? g.lng : null, cover, priceFrom: Number.isFinite(from[String(h._id)]) ? from[String(h._id)] : null,
    });
  }
  cache = { at: Date.now(), data: out };
  return out;
}
