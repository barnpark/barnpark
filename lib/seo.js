// ===== ให้ Google หาเจอ: robots.txt + sitemap.xml (หน้าแรก + หน้าจองของทุกที่พักที่แสดงบนแผนที่) =====
// ข้อมูลที่พักแบบที่ Google อ่านได้ (JSON-LD) อยู่ใน lib/og.js (ใส่ในหน้าจองฝั่งเซิร์ฟเวอร์)
import Hotel from "../models/Hotel.js";

const xml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const siteBase = (req) => {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  return (process.env.PUBLIC_URL || proto + "://" + req.get("host")).replace(/\/+$/, "");
};

// หน้าหลังบ้าน/เข้าสู่ระบบ/เอกสารส่วนตัว และ API ไม่ต้องขึ้นใน Google
export function robotsTxt(base) {
  return ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /app.html", "Disallow: /admin.html", "Disallow: /login.html", "Disallow: /receipt.html", "", `Sitemap: ${base}/sitemap.xml`, ""].join("\n");
}

// เฉพาะที่พักที่อนุมัติแล้วและไม่ได้พักการใช้งาน (ปิดการแสดงบนแผนที่ ยังขึ้น Google ได้)
export async function sitemapXml(base) {
  const hotels = await Hotel.find({ approved: { $ne: false }, status: { $ne: "paused" } }).select("slug updatedAt").sort("slug").lean();
  const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const url = (loc, mod, pri) => `  <url><loc>${xml(loc)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ""}<priority>${pri}</priority></url>`;
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url(base + "/", "", "1.0"),
    ...hotels.map((h) => url(`${base}/book.html?h=${encodeURIComponent(h.slug)}`, day(h.updatedAt), "0.8")),
    "</urlset>", ""].join("\n");
}
