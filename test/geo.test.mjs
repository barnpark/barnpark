// แผนที่ที่พักหน้าแรก (lib/geo.js, GET /api/public/map) — อ่านพิกัดจากลิงก์ Google Maps · ตามลิงก์ย่อ · กรองที่พักที่แสดง
const fetches = [];
let redirects = {};
globalThis.fetch = async (url, opt = {}) => {
  url = String(url); fetches.push(url);
  if (redirects[url]) return new Response(null, { status: 302, headers: { location: redirects[url] } });
  return new Response("", { status: 200 });
};
const Hotel = (await import("../models/Hotel.js")).default;
const RoomType = (await import("../models/RoomType.js")).default;
const { latLngFromUrl, expandShortMapUrl, hotelsForMap } = await import("../lib/geo.js");

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- อ่านพิกัดจากลิงก์แบบต่าง ๆ
t("api=1&query=lat,lng (ส่งตำแหน่งผ่าน LINE)", eq(latLngFromUrl("https://www.google.com/maps/search/?api=1&query=13.756331,100.501765"), { lat: 13.756331, lng: 100.501765 }));
t("@lat,lng,zoom", eq(latLngFromUrl("https://www.google.com/maps/place/Foo/@18.7883,98.9853,15z/data=x"), { lat: 18.7883, lng: 98.9853 }));
t("!3d!4d pin beats @ viewport", eq(latLngFromUrl("https://www.google.com/maps/place/X/@18.70,98.90,12z/data=!3m1!4b1!4m6!3m5!8m2!3d18.7883!4d98.9853"), { lat: 18.7883, lng: 98.9853 }));
t("?q=lat,lng with spaces / encoded comma", eq(latLngFromUrl("https://maps.google.com/?q=7.8804%2C%2098.3923"), { lat: 7.8804, lng: 98.3923 }));
t("no coordinates → null", latLngFromUrl("https://maps.app.goo.gl/AbCdEf") === null && latLngFromUrl("") === null && latLngFromUrl("https://www.google.com/maps/place/Bangkok") === null);
t("out-of-range rejected", latLngFromUrl("https://x/?q=95.1,100.2") === null);

// ---- ลิงก์ย่อ
redirects = { "https://maps.app.goo.gl/AbCdEf": "https://www.google.com/maps/place/Home/@14.0,99.5,15z" };
t("short link expanded via redirect", (await expandShortMapUrl("https://maps.app.goo.gl/AbCdEf")) === "https://www.google.com/maps/place/Home/@14.0,99.5,15z");
redirects = { "https://maps.app.goo.gl/Evil": "https://evil.example/@1.0,2.0" };
t("redirect off Google → rejected", (await expandShortMapUrl("https://maps.app.goo.gl/Evil")) === "");
t("non-short links not fetched", (fetches.length, await expandShortMapUrl("https://example.com/x")) === "https://example.com/x" && !fetches.includes("https://example.com/x"));

// ---- รายการบนแผนที่
const hotels = [
  { _id: "h1", name: "บ้านริมน้ำ", slug: "rimnam", location: "เชียงใหม่", mapUrl: "https://www.google.com/maps/search/?api=1&query=18.7883,98.9853", coverUrl: "https://cdn.example/c.jpg" },
  { _id: "h2", name: "สวนป่า", slug: "suanpa", location: "กาญจนบุรี", mapUrl: "https://maps.app.goo.gl/AbCdEf", coverUrl: "data:image/png;base64,xx" },
  { _id: "h3", name: "ไม่มีหมุด", slug: "nopin", location: "น่าน", mapUrl: "" },
  { _id: "h4", name: "จำพิกัดแล้ว", slug: "cached", mapUrl: "https://maps.app.goo.gl/Cached", geoFrom: "https://maps.app.goo.gl/Cached", geo: { lat: 12.5, lng: 99.9 } },
];
let lastQuery = null; const saved = [];
Hotel.find = (q) => { lastQuery = q; return { select() { return this; }, sort() { return this; }, lean: async () => hotels.map((h) => ({ ...h })) }; };
Hotel.updateOne = async (q, u) => { saved.push([q._id, u.$set]); return { modifiedCount: 1 }; };
RoomType.find = (q) => ({ select() { return this; }, lean: async () => [
  { hotel: "h1", basePrice: 1500 }, { hotel: "h1", basePrice: 900 }, { hotel: "h2", basePrice: 1200 } ] });
redirects = { "https://maps.app.goo.gl/AbCdEf": "https://www.google.com/maps/place/Home/@14.0,99.5,15z" };
const before = fetches.length;
const list = await hotelsForMap({ fresh: true });
t("only approved, active, on-map hotels queried", eq(lastQuery, { approved: { $ne: false }, status: { $ne: "paused" }, onMap: { $ne: false } }), lastQuery);
const by = Object.fromEntries(list.map((h) => [h.slug, h]));
t("coords from full link", by.rimnam.lat === 18.7883 && by.rimnam.lng === 98.9853);
t("coords from short link (followed once)", by.suanpa.lat === 14 && by.suanpa.lng === 99.5);
t("no map link → listed without pin", by.nopin.lat === null && by.nopin.lng === null);
t("remembered coords reused, no fetch", by.cached.lat === 12.5 && !fetches.slice(before).includes("https://maps.app.goo.gl/Cached"));
t("lowest visible room price", by.rimnam.priceFrom === 900 && by.suanpa.priceFrom === 1200 && by.nopin.priceFrom === null);
t("cover: https only (no inline data images)", by.rimnam.cover === "https://cdn.example/c.jpg" && by.suanpa.cover === "");
t("coords saved with the link they came from", saved.some(([id, s]) => id === "h2" && s.geoFrom === "https://maps.app.goo.gl/AbCdEf" && s.geo.lat === 14) && saved.some(([id, s]) => id === "h3" && s.geo === null));
t("no private fields leak", list.every((h) => eq(Object.keys(h).sort(), ["cover", "lat", "lng", "location", "name", "priceFrom", "slug", "tagline"])), Object.keys(list[0]));
const n0 = fetches.length;
await hotelsForMap();
t("cached for 5 minutes", fetches.length === n0);

// ---- ลบ/แก้ที่พักหรือห้อง → แผนที่อัปเดตทันที (ไม่ต้องรอแคช 5 นาที)
const { mapVersion, bumpMap } = await import("../lib/mapcache.js");
let finds = 0; const realFind = Hotel.find;
Hotel.find = (q) => { finds++; return realFind(q); };
await hotelsForMap(); const f0 = finds;
await hotelsForMap();
t("unchanged data → served from cache", finds === f0);
hotels.splice(hotels.findIndex((h) => h.slug === "rimnam"), 1); // ลบที่พัก
bumpMap();
const after = await hotelsForMap();
t("after a change → recomputed, deleted hotel gone", finds === f0 + 1 && !after.some((h) => h.slug === "rimnam"), after.map((h) => h.slug));
// middleware ที่ผูกกับโมเดลจริง
const hooks = (M, name) => (M.schema.s.hooks._posts.get(name) || []).map((x) => x.fn).filter((fn) => fn === bumpMap || /bumpMap\(\)/.test(String(fn))); // เฉพาะของเรา (ไม่รวม plugin ของ mongoose)
const run = (M, name, upd) => { const v = mapVersion(); for (const fn of hooks(M, name)) fn.call({ getUpdate: () => upd }, {}); return mapVersion() > v; };
t("Hotel delete clears map cache", run(Hotel, "deleteOne") && run(Hotel, "deleteMany") && run(Hotel, "findOneAndDelete"));
t("Hotel edit (onMap/status/approved/mapUrl) clears map cache", run(Hotel, "findOneAndUpdate", { onMap: false }) && run(Hotel, "updateOne", { $set: { status: "paused" } }) && run(Hotel, "updateMany", { $set: { approved: false } }));
t("Hotel created/saved clears map cache", run(Hotel, "save"));
t("map's own geo save does NOT clear cache (no loop)", !run(Hotel, "updateOne", { $set: { geo: { lat: 1, lng: 2 }, geoFrom: "x" } }));
t("room price/visibility change clears map cache", run(RoomType, "findOneAndUpdate", { $set: { basePrice: 500 } }) && run(RoomType, "deleteOne") && run(RoomType, "save"));

console.log(`geo: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
