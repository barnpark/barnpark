// ===== หน้าจองของแต่ละที่พัก: ใส่ชื่อ/คำโปรย/รูปปกลง meta (Open Graph) =====
// เวลาแชร์ลิงก์ใน LINE / Facebook / Messenger จะขึ้นการ์ดชื่อที่พัก + รูปปก (แทน "จองที่พัก" เปล่า ๆ)
// บอทของแอปพวกนี้ไม่รัน JavaScript จึงต้องใส่ค่าตั้งแต่ฝั่งเซิร์ฟเวอร์
// + ข้อมูลที่พักแบบที่ Google อ่านได้ (JSON-LD: ชื่อ ที่อยู่ พิกัด ราคา เวลาเช็คอิน คะแนนรีวิว) และลิงก์ canonical
// ที่พักที่ยังไม่อนุมัติ/พักการใช้งาน → noindex (ไม่ขึ้นใน Google)
import fs from "fs";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Review from "../models/Review.js";
import { stayInfo } from "./stay.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cut = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

export function bookPageHandler(file) {
  let html = null;
  const load = () => (html ??= fs.readFileSync(file, "utf8"));
  return async (req, res, next) => {
    const slug = String(req.query.h || "").toLowerCase();
    if (!slug || !/^[a-z0-9-]{1,80}$/.test(slug)) return next();
    try {
      const h = await Hotel.findOne({ slug }).select("name slug tagline about location coverUrl logoUrl phone address mapUrl geo amenities checkInTime checkOutTime approved status").lean();
      if (!h) return next();
      const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0];
      const base = (process.env.PUBLIC_URL || proto + "://" + req.get("host")).replace(/\/+$/, "");
      const url = `${base}/book.html?h=${encodeURIComponent(h.slug)}`;
      const pic = h.coverUrl || h.logoUrl || "";
      const img = pic ? (/^https:\/\//i.test(pic) ? pic : pic.startsWith("/") ? base + pic : "") : "";
      const title = `${cut(h.name, 70)} · จองตรงกับที่พัก`;
      const desc = cut(h.tagline || h.about || [h.location ? "📍 " + h.location : "", "จองตรงกับที่พัก ราคาดีที่สุด ยืนยันทันที"].filter(Boolean).join(" · "), 180);
      const tags = [
        `<title>${esc(title)}</title>`,
        `<meta name="description" content="${esc(desc)}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="${esc(cut(h.name, 70))}">`,
        `<meta property="og:title" content="${esc(title)}">`,
        `<meta property="og:description" content="${esc(desc)}">`,
        `<meta property="og:url" content="${esc(url)}">`,
        img ? `<meta property="og:image" content="${esc(img)}">` : "",
        `<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">`,
        `<link rel="canonical" href="${esc(url)}">`,
      ];
      const listed = h.approved !== false && h.status !== "paused";
      if (!listed) tags.push(`<meta name="robots" content="noindex">`);
      else tags.push(`<script type="application/ld+json">${JSON.stringify(await lodgingLd(h, url, img, desc)).replace(/</g, "\\u003c")}</script>`);
      const head = tags.filter(Boolean).join("\n");
      res.set("Content-Type", "text/html; charset=utf-8").set("Cache-Control", "no-cache");
      res.send(load().replace(/<title>[^<]*<\/title>/, () => head));
    } catch (e) { next(); }
  };
}

// ข้อมูลที่พักตาม schema.org (LodgingBusiness) — เฉพาะข้อมูลที่แสดงบนหน้าจองอยู่แล้ว
export async function lodgingLd(h, url, img, desc) {
  const [rooms, reviews] = await Promise.all([
    RoomType.find({ hotel: h._id, hidden: { $ne: true }, basePrice: { $gt: 0 } }).select("basePrice").lean(),
    Review.find({ hotel: h._id, approved: true }).select("rating").lean(),
  ]);
  const st = stayInfo(h), prices = rooms.map((r) => r.basePrice).filter((p) => p > 0);
  const ld = { "@context": "https://schema.org", "@type": "LodgingBusiness", name: cut(h.name, 120), url, description: desc };
  if (img) ld.image = img;
  if (h.phone) ld.telephone = String(h.phone).slice(0, 30);
  if (st.address || h.location) ld.address = { "@type": "PostalAddress", streetAddress: cut(st.address || h.location, 200), ...(h.location ? { addressRegion: cut(h.location, 80) } : {}), addressCountry: "TH" };
  if (h.geo && Number.isFinite(h.geo.lat) && Number.isFinite(h.geo.lng)) ld.geo = { "@type": "GeoCoordinates", latitude: h.geo.lat, longitude: h.geo.lng };
  if (st.mapUrl) ld.hasMap = st.mapUrl;
  if (st.checkInTime) ld.checkinTime = st.checkInTime;
  if (st.checkOutTime) ld.checkoutTime = st.checkOutTime;
  if (prices.length) ld.priceRange = `฿${Math.min(...prices).toLocaleString("en-US")} - ฿${Math.max(...prices).toLocaleString("en-US")}`;
  const am = (h.amenities || []).slice(0, 20).map((a) => ({ "@type": "LocationFeatureSpecification", name: cut(String(a).replace(/^[^\p{L}\p{N}]+/u, ""), 40), value: true })).filter((a) => a.name);
  if (am.length) ld.amenityFeature = am;
  if (reviews.length) {
    const avg = reviews.reduce((t, r) => t + Math.max(1, Math.min(5, +r.rating || 5)), 0) / reviews.length;
    ld.aggregateRating = { "@type": "AggregateRating", ratingValue: Math.round(avg * 10) / 10, reviewCount: reviews.length, bestRating: 5, worstRating: 1 };
  }
  return ld;
}
