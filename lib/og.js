// ===== หน้าจองของแต่ละที่พัก: ใส่ชื่อ/คำโปรย/รูปปกลง meta (Open Graph) =====
// เวลาแชร์ลิงก์ใน LINE / Facebook / Messenger จะขึ้นการ์ดชื่อที่พัก + รูปปก (แทน "จองที่พัก" เปล่า ๆ)
// บอทของแอปพวกนี้ไม่รัน JavaScript จึงต้องใส่ค่าตั้งแต่ฝั่งเซิร์ฟเวอร์
import fs from "fs";
import Hotel from "../models/Hotel.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cut = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

export function bookPageHandler(file) {
  let html = null;
  const load = () => (html ??= fs.readFileSync(file, "utf8"));
  return async (req, res, next) => {
    const slug = String(req.query.h || "").toLowerCase();
    if (!slug || !/^[a-z0-9-]{1,80}$/.test(slug)) return next();
    try {
      const h = await Hotel.findOne({ slug }).select("name slug tagline about location coverUrl logoUrl").lean();
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
      ].filter(Boolean).join("\n");
      res.set("Content-Type", "text/html; charset=utf-8").set("Cache-Control", "no-cache");
      res.send(load().replace(/<title>[^<]*<\/title>/, tags));
    } catch (e) { next(); }
  };
}
