// ===== พิกัดของที่พัก (แผนที่หน้าแรก Barn Park) =====
// อ่านจากลิงก์ Google Maps ที่ที่พักใส่ไว้ (Hotel.mapUrl — ใส่เองในเว็บหลังบ้าน หรือส่งตำแหน่งผ่าน LINE)
// ลิงก์ย่อ (maps.app.goo.gl / goo.gl/maps) ตามไปหาลิงก์เต็มครั้งเดียวแล้วจำไว้ (Hotel.geo + geoFrom)
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Review from "../models/Review.js";
import { mapVersion } from "./mapcache.js";
import { usedPeaks } from "./availability.js";
import { rateFor } from "./pricing.js";
import { breakfastOf } from "./stay.js";

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

// ที่พักที่แสดงบนแผนที่: อนุมัติแล้ว ไม่ได้พักการใช้งาน และไม่ได้ปิดการแสดงบนแผนที่
const VISIBLE = { approved: { $ne: false }, status: { $ne: "paused" }, onMap: { $ne: false } };
const SELLING = { hidden: { $ne: true }, basePrice: { $gt: 0 } };

// รายการที่พักบนแผนที่ (หน้าแรก) — ชื่อ พิกัด รูปปก ราคาเริ่มต้น + ข้อมูลสำหรับตัวกรอง (สิ่งอำนวยฯ อาหารเช้า ยกเลิกฟรี รีวิว)
// แคชในหน่วยความจำ — ใช้ได้จนกว่าข้อมูลที่พัก/ห้อง/รีวิวจะเปลี่ยน (mapVersion) หรือครบ 5 นาที
let cache = { at: 0, v: -1, data: null };
export async function hotelsForMap({ fresh = false } = {}) {
  if (!fresh && cache.data && cache.v === mapVersion() && Date.now() - cache.at < 5 * 60e3) return cache.data;
  const v = mapVersion();
  const hotels = await Hotel.find(VISIBLE)
    .select("name slug location tagline mapUrl geo geoFrom coverUrl amenities allowGuestCancel cancelDays updatedAt").sort("name").lean();
  const ids = hotels.map((h) => h._id);
  const [rooms, reviews] = ids.length ? await Promise.all([
    RoomType.find({ hotel: { $in: ids }, ...SELLING }).select("hotel basePrice breakfast breakfastPrice amenities").lean(),
    Review.find({ hotel: { $in: ids }, approved: true }).select("hotel rating").lean(),
  ]) : [[], []];
  const from = {}, bf = {}, rv = {};
  for (const r of rooms) {
    const k = String(r.hotel);
    from[k] = Math.min(from[k] ?? Infinity, r.basePrice);
    if (breakfastOf(r).mode !== "none") bf[k] = true;
  }
  for (const r of reviews) { const o = (rv[String(r.hotel)] ||= { sum: 0, n: 0 }); o.sum += Math.max(1, Math.min(5, +r.rating || 5)); o.n++; }
  const budget = { n: 3 };
  const out = [];
  for (const h of hotels) {
    const k = String(h._id), g = await geoOf(h, budget), r = rv[k];
    const cover = /^https:\/\//.test(h.coverUrl || "") || /^\/api\/public\/img\/cover\//.test(h.coverUrl || "") ? h.coverUrl : "";
    out.push({
      name: h.name || "", slug: h.slug, location: String(h.location || "").slice(0, 80), tagline: String(h.tagline || "").slice(0, 120),
      lat: g ? g.lat : null, lng: g ? g.lng : null, cover, priceFrom: Number.isFinite(from[k]) ? from[k] : null,
      amenities: (h.amenities || []).map((a) => String(a).slice(0, 30)).slice(0, 20),
      breakfast: !!bf[k] || (h.amenities || []).some((a) => /อาหารเช้า/.test(a)),
      freeCancelDays: h.allowGuestCancel !== false ? Math.max(0, h.cancelDays ?? 3) : null,
      rating: r ? Math.round((r.sum / r.n) * 10) / 10 : null, reviews: r ? r.n : 0,
    });
  }
  cache = { at: Date.now(), v, data: out };
  return out;
}

// ห้องว่างของทุกที่พักบนแผนที่ ตามวันที่และจำนวนผู้เข้าพัก (ค้นหาบนหน้าแรก)
// ว่าง = ห้องที่ยังว่างทุกคืนรวมกันพอสำหรับจำนวนคน (นับตามความจุของห้อง) · from = ราคาต่ำสุดต่อคืนของห้องที่ว่าง (ราคาตามฤดูของวันเช็คอิน)
export async function mapAvailability(din, dout, guests = 1) {
  const nights = Math.round((new Date(dout + "T00:00:00Z") - new Date(din + "T00:00:00Z")) / 864e5);
  const hotels = await Hotel.find(VISIBLE).select("slug").lean();
  const ids = hotels.map((h) => h._id);
  const rts = ids.length ? await RoomType.find({ hotel: { $in: ids }, ...SELLING }).select("hotel qty capacity basePrice seasons").lean() : [];
  const used = await usedPeaks(rts.map((t) => t._id), din, dout);
  const by = {};
  for (const t of rts) {
    const free = Math.max(0, (t.qty || 0) - (used[String(t._id)] || 0)), rate = rateFor(t, din);
    if (!free || !(rate.price > 0) || (rate.minNights && nights < rate.minNights)) continue;
    const o = (by[String(t.hotel)] ||= { rooms: 0, beds: 0, from: Infinity });
    o.rooms += free; o.beds += free * Math.max(1, t.capacity || 2); o.from = Math.min(o.from, rate.price);
  }
  return hotels.map((h) => {
    const o = by[String(h._id)], ok = !!o && o.beds >= guests;
    return { slug: h.slug, available: ok, from: ok ? o.from : null, rooms: ok ? o.rooms : 0 };
  });
}
