// ค้นหาที่พักตามวันที่ (GET /api/public/map/avail) · robots.txt · sitemap.xml · ข้อมูลที่พักสำหรับ Google (lib/og.js JSON-LD) — ไม่ต้องมีฐานข้อมูล
import fs from "fs";
import os from "os";
import path from "path";
Object.assign(process.env, { PUBLIC_URL: "https://bp.test" });
const realFetch = globalThis.fetch;
const express = (await import("express")).default;
const M = {};
for (const n of ["Hotel", "RoomType", "Booking", "Review"]) M[n] = (await import(`../models/${n}.js`)).default;
const publicRoutes = (await import("../routes/public.js")).default;
const { robotsTxt, sitemapXml } = await import("../lib/seo.js");
const { bookPageHandler } = await import("../lib/og.js");

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
const q = (v) => ({ select() { return this; }, sort() { return this; }, lean: async () => (typeof v === "function" ? v() : v), then(a, b) { return this.lean().then(a, b); } });
const ymd = (n) => new Date(Date.now() + 7 * 3600e3 + n * 864e5).toISOString().slice(0, 10);

const HID = "64b7f0c2a1b2c3d4e5f60718";
let hotel = { _id: HID, slug: "baan-rim-nam", name: "บ้านริมน้ำ </script><b>", tagline: "พักริมน้ำ", location: "เชียงใหม่", phone: "081-111-1111", address: "1 ม.2 แม่ริม",
  geo: { lat: 18.9, lng: 98.9 }, mapUrl: "https://maps.google.com/?q=18.9,98.9", amenities: ["🏊 สระว่ายน้ำ", "📶 Wi-Fi"], checkInTime: "14:00", checkOutTime: "12:00", coverUrl: "https://cdn.test/c.jpg", updatedAt: new Date("2026-10-20T00:00:00Z"),
  lineChannelToken: "SECRET-TOKEN", promptpayId: "0899999999" };
let hotelQuery = null;
M.Hotel.find = (f) => { hotelQuery = f; return q([{ ...hotel }]); };
M.Hotel.findOne = () => q(() => (hotel ? { ...hotel } : null));
M.RoomType.find = () => q([{ _id: "r1", hotel: HID, qty: 1, capacity: 2, basePrice: 1200 }, { _id: "r2", hotel: HID, qty: 1, capacity: 2, basePrice: 2500 }]);
M.Booking.find = () => q([]);
M.Review.find = () => q([{ rating: 5 }, { rating: 4 }]);

// ---- GET /api/public/map/avail
const app = express(); app.use(express.json()); app.use("/api/public", publicRoutes);
const srv = app.listen(0); await new Promise((r) => srv.once("listening", r));
const base = "http://127.0.0.1:" + srv.address().port;
const get = async (u) => { const r = await realFetch(base + u); return { status: r.status, json: await r.json().catch(() => null), cc: r.headers.get("cache-control") }; };
let r = await get(`/api/public/map/avail?din=${ymd(3)}&dout=${ymd(5)}&guests=2`);
t("map avail: ok", r.status === 200 && r.json[0].slug === "baan-rim-nam" && r.json[0].available && r.json[0].from === 1200 && r.cc === "no-store", r);
t("map avail: only slug/available/from/rooms (no hotel data)", Object.keys(r.json[0]).sort().join() === "available,from,rooms,slug", r.json[0]);
for (const [name, qs] of [["past check-in", `din=${ymd(-2)}&dout=${ymd(1)}`], ["check-out before check-in", `din=${ymd(5)}&dout=${ymd(3)}`], ["more than 30 nights", `din=${ymd(1)}&dout=${ymd(40)}`], ["bad format", "din=1/11/2026&dout=3/11/2026"], ["missing", ""], ["too far ahead", `din=${ymd(800)}&dout=${ymd(802)}`]])
  t("map avail: rejects " + name, (await get("/api/public/map/avail?" + qs)).status === 400);
r = await get(`/api/public/map/avail?din=${ymd(3)}&dout=${ymd(5)}&guests=999`);
t("map avail: guests clamped (30 > 4 beds → not available)", r.status === 200 && r.json[0].available === false, r.json);
srv.close();

// ---- robots.txt + sitemap.xml
const robots = robotsTxt("https://bp.test");
t("robots: back office and API hidden, sitemap linked", /Disallow: \/api\//.test(robots) && /Disallow: \/app\.html/.test(robots) && /Disallow: \/admin\.html/.test(robots) && /Disallow: \/receipt\.html/.test(robots) && /Sitemap: https:\/\/bp\.test\/sitemap\.xml/.test(robots));
const sm = await sitemapXml("https://bp.test");
t("sitemap: home + each booking page with lastmod", sm.includes("<loc>https://bp.test/</loc>") && sm.includes("<loc>https://bp.test/book.html?h=baan-rim-nam</loc><lastmod>2026-10-20</lastmod>"), sm);
t("sitemap: only approved, active hotels", hotelQuery.approved.$ne === false && hotelQuery.status.$ne === "paused", hotelQuery);

// ---- หน้าจอง: meta + JSON-LD สำหรับ Google
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-og-")), file = path.join(dir, "book.html");
fs.writeFileSync(file, "<html><head><title>จองที่พัก</title></head><body></body></html>");
const page = async () => {
  let out = ""; const res = { set() { return res; }, send(s) { out = s; } };
  await bookPageHandler(file)({ query: { h: "baan-rim-nam" }, get: (k) => (k === "host" ? "bp.test" : ""), protocol: "https" }, res, () => { out = "NEXT"; });
  return out;
};
let html = await page();
const ldTxt = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] || "";
let ld = null; try { ld = JSON.parse(ldTxt); } catch {}
t("JSON-LD present and valid", ld && ld["@type"] === "LodgingBusiness" && ld.url === "https://bp.test/book.html?h=baan-rim-nam", ldTxt.slice(0, 200));
t("JSON-LD: address, geo, times, price range, rating", ld && ld.address.addressCountry === "TH" && ld.geo.latitude === 18.9 && ld.checkinTime === "14:00" && ld.priceRange === "฿1,200 - ฿2,500" && ld.aggregateRating.ratingValue === 4.5 && ld.aggregateRating.reviewCount === 2, ld);
t("JSON-LD: amenities without emoji", ld && ld.amenityFeature[0].name === "สระว่ายน้ำ" && ld.amenityFeature[1].name === "Wi-Fi", ld && ld.amenityFeature);
t("JSON-LD can't break out of the script tag", !ldTxt.includes("</script") && !ldTxt.includes("<b>"));
t("no secrets in the page", !html.includes("SECRET-TOKEN") && !html.includes("0899999999"));
t("canonical link + indexable", html.includes('<link rel="canonical" href="https://bp.test/book.html?h=baan-rim-nam">') && !html.includes("noindex"));
hotel = { ...hotel, approved: false };
html = await page();
t("unapproved hotel: noindex, no JSON-LD", html.includes('<meta name="robots" content="noindex">') && !html.includes("ld+json"));
hotel = { ...hotel, approved: true, status: "paused" };
t("paused hotel: noindex", (await page()).includes("noindex"));
M.Review.find = () => q([]); hotel = { ...hotel, status: "active" };
html = await page();
t("no reviews → no rating in JSON-LD", html.includes("ld+json") && !html.includes("aggregateRating"));
fs.rmSync(dir, { recursive: true, force: true });

console.log(`discovery: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
