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
const Review = (await import("../models/Review.js")).default;
const Booking = (await import("../models/Booking.js")).default;
const { latLngFromUrl, expandShortMapUrl, hotelsForMap, mapAvailability, cleanPin, pinOf } = await import("../lib/geo.js");
const fs = await import("fs");
const vm = await import("vm");

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

// ---- หมุดที่แอดมินยืนยัน (Hotel.pin)
t("cleanPin: numbers or numeric strings, 6 decimals", eq(cleanPin({ lat: "13.864854", lng: 101.7824131 }), { lat: 13.864854, lng: 101.782413 }) && eq(cleanPin({ lat: -33.8, lng: " 151.2 " }), { lat: -33.8, lng: 151.2 }));
t("cleanPin: rejects out of range, 0,0, junk, missing, arrays, booleans", [{ lat: 95, lng: 100 }, { lat: 13, lng: 190 }, { lat: 0, lng: 0 }, { lat: "13,5", lng: "100" }, { lat: "abc", lng: 100 }, { lat: 13 }, { lat: [13], lng: [100] }, { lat: true, lng: 100 }, { lat: "1e1", lng: "100" }, null, "13.7, 100.5", 5].every((b) => cleanPin(b) === null));
t("pinOf: only a valid pin counts", eq(pinOf({ pin: { lat: 13.5, lng: 100.5, at: new Date() } }), { lat: 13.5, lng: 100.5 }) && pinOf({ pin: { lat: null, lng: null } }) === null && pinOf({}) === null && pinOf(null) === null);
// ตัวอ่านพิกัดในหน้าแอดมิน (public/admin.html → pinParse) ต้องอ่านลิงก์ได้เหมือนเซิร์ฟเวอร์
const adminSrc = fs.readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const pi = adminSrc.indexOf("function pinParse(");
let pj = adminSrc.indexOf("{", pi); for (let d = 0; pj < adminSrc.length; pj++) { if (adminSrc[pj] === "{") d++; else if (adminSrc[pj] === "}" && !--d) break; }
const pinParse = vm.runInNewContext("(" + adminSrc.slice(pi, pj + 1) + ")");
for (const u of ["https://www.google.com/maps/search/?api=1&query=13.756331,100.501765", "https://www.google.com/maps/place/Foo/@18.7883,98.9853,15z/data=x",
  "https://www.google.com/maps/place/X/@18.70,98.90,12z/data=!3m1!4b1!4m6!3m5!8m2!3d18.7883!4d98.9853", "https://maps.google.com/?q=7.8804%2C%2098.3923",
  "https://maps.app.goo.gl/AbCdEf?g_st=il", "https://www.google.com/maps/place/Bangkok", "https://x/?q=95.1,100.2", ""])
  t("admin page parser = server parser: " + (u.slice(8, 60) || "(empty)"), eq(pinParse(u), latLngFromUrl(u)), [pinParse(u), latLngFromUrl(u)]);
t("admin page parser: coordinates copied from Google Maps", eq(pinParse(" 13.864854, 101.782413 "), { lat: 13.864854, lng: 101.782413 }) && eq(pinParse("17.131967 99.41093"), { lat: 17.131967, lng: 99.41093 }));
t("admin page parser: rejects junk / 0,0 / out of range", pinParse("ไม่มีพิกัด") === null && pinParse("0.0, 0.0") === null && pinParse("100.5, 13.7") === null && pinParse("13.7, 100.5, 3") === null);

// ---- ลิงก์ย่อ
redirects = { "https://maps.app.goo.gl/AbCdEf": "https://www.google.com/maps/place/Home/@14.0,99.5,15z" };
t("short link expanded via redirect", (await expandShortMapUrl("https://maps.app.goo.gl/AbCdEf")) === "https://www.google.com/maps/place/Home/@14.0,99.5,15z");
redirects = { "https://maps.app.goo.gl/Evil": "https://evil.example/@1.0,2.0" };
t("redirect off Google → rejected", (await expandShortMapUrl("https://maps.app.goo.gl/Evil")) === "");
t("non-short links not fetched", (fetches.length, await expandShortMapUrl("https://example.com/x")) === "https://example.com/x" && !fetches.includes("https://example.com/x"));

// ---- รายการบนแผนที่
const hotels = [
  { _id: "h1", name: "บ้านริมน้ำ", slug: "rimnam", location: "เชียงใหม่", mapUrl: "https://www.google.com/maps/search/?api=1&query=18.7883,98.9853", coverUrl: "https://cdn.example/c.jpg", amenities: ["🏊 สระว่ายน้ำ", "🐶 รับสัตว์เลี้ยง"], cancelDays: 5 },
  { _id: "h2", name: "สวนป่า", slug: "suanpa", location: "กาญจนบุรี", mapUrl: "https://maps.app.goo.gl/AbCdEf", coverUrl: "data:image/png;base64,xx" },
  { _id: "h3", name: "ไม่มีหมุด", slug: "nopin", location: "น่าน", mapUrl: "", allowGuestCancel: false, amenities: ["🍳 อาหารเช้า"] },
  { _id: "h4", name: "จำพิกัดแล้ว", slug: "cached", mapUrl: "https://maps.app.goo.gl/Cached", geoFrom: "https://maps.app.goo.gl/Cached", geo: { lat: 12.5, lng: 99.9 } },
  { _id: "h5", name: "เพจเฟซบุ๊ก", slug: "fbpage", mapUrl: "", coverUrl: "https://www.facebook.com/p/The-Y-Habitat-Hotel-61588588984725/" },
  { _id: "h6", name: "แอดมินยืนยันหมุด", slug: "pinned", mapUrl: "https://maps.app.goo.gl/IphoneShare?g_st=il", pin: { lat: 13.864854, lng: 101.782413, at: new Date("2026-11-23T08:00:00Z") } },
  { _id: "h7", name: "หมุดเสีย", slug: "badpin", mapUrl: "https://www.google.com/maps/search/?api=1&query=15.1,100.2", pin: { lat: 200, lng: 5 } },
  { _id: "h8", name: "หมุดแต่ไม่มีลิงก์", slug: "pinonly", mapUrl: "", pin: { lat: 9.5, lng: 99.9 } },
];
let lastQuery = null; const saved = [];
const pick = (o, f) => { if (!f) return o; const k = ["_id", ...f.split(/\s+/).filter(Boolean)]; return Object.fromEntries(Object.entries(o).filter(([x]) => k.includes(x))); };
Hotel.find = (q) => { lastQuery = q; let f = null; return { select(x) { f = x; return this; }, sort() { return this; }, lean: async () => hotels.map((h) => pick({ ...h }, f)) }; };
Hotel.updateOne = async (q, u) => { saved.push([q._id, u.$set]); return { modifiedCount: 1 }; };
let rtQuery = null;
RoomType.find = (q) => { rtQuery = q; return { select() { return this; }, lean: async () => [
  { hotel: "h1", basePrice: 1500 }, { hotel: "h1", basePrice: 900, breakfast: "optional", breakfastPrice: 150 }, { hotel: "h2", basePrice: 1200, breakfast: "none" } ] }; };
let rvQuery = null;
Review.find = (q) => { rvQuery = q; return { select() { return this; }, lean: async () => [{ hotel: "h1", rating: 5 }, { hotel: "h1", rating: 4 }, { hotel: "h1", rating: 4 }, { hotel: "h2", rating: 9 }] }; };
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
t("cover: a Facebook page link is not an image → no cover (card shows the first letter)", by.fbpage.cover === "", by.fbpage);
t("admin pin beats the owner's link (iPhone share link not even fetched)", by.pinned.lat === 13.864854 && by.pinned.lng === 101.782413 && !fetches.includes("https://maps.app.goo.gl/IphoneShare?g_st=il") && !saved.some(([id]) => id === "h6"), by.pinned);
t("admin pin works without any map link", by.pinonly.lat === 9.5 && by.pinonly.lng === 99.9, by.pinonly);
t("invalid pin ignored → link coordinates used", by.badpin.lat === 15.1 && by.badpin.lng === 100.2, by.badpin);
t("coords saved with the link they came from", saved.some(([id, s]) => id === "h2" && s.geoFrom === "https://maps.app.goo.gl/AbCdEf" && s.geo.lat === 14) && saved.some(([id, s]) => id === "h3" && s.geo === null));
t("no private fields leak", list.every((h) => eq(Object.keys(h).sort(), ["amenities", "breakfast", "cover", "freeCancelDays", "lat", "lng", "location", "name", "priceFrom", "rating", "reviews", "slug", "tagline"])), Object.keys(list[0]));
t("rating = average of approved reviews only", rvQuery.approved === true && by.rimnam.rating === 4.3 && by.rimnam.reviews === 3 && by.suanpa.rating === 5 && by.nopin.rating === null && by.nopin.reviews === 0, [by.rimnam, rvQuery]);
t("breakfast from rooms or the hotel's amenities", by.rimnam.breakfast === true && by.suanpa.breakfast === false && by.nopin.breakfast === true);
t("free cancellation days (null when guests can't cancel online)", by.rimnam.freeCancelDays === 5 && by.suanpa.freeCancelDays === 3 && by.nopin.freeCancelDays === null);
t("amenities passed for filters", eq(by.rimnam.amenities, ["🏊 สระว่ายน้ำ", "🐶 รับสัตว์เลี้ยง"]) && eq(by.cached.amenities, []));
t("only rooms on sale counted", rtQuery.hidden.$ne === true && rtQuery.basePrice.$gt === 0);
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
t("admin pin set / cleared clears map cache", run(Hotel, "findOneAndUpdate", { $set: { pin: { lat: 13.8, lng: 101.7, at: new Date() } } }) && run(Hotel, "findOneAndUpdate", { $unset: { pin: 1 } }));
t("map's own geo save does NOT clear cache (no loop)", !run(Hotel, "updateOne", { $set: { geo: { lat: 1, lng: 2 }, geoFrom: "x" } }));
t("room price/visibility change clears map cache", run(RoomType, "findOneAndUpdate", { $set: { basePrice: 500 } }) && run(RoomType, "deleteOne") && run(RoomType, "save"));

t("review approve/delete clears map cache", run(Review, "findOneAndUpdate", { approved: true }) && run(Review, "deleteOne"));

// ---- ห้องว่างตามวันที่บนแผนที่ (หน้าแรก)
const rts = [
  { _id: "r1", hotel: "h1", qty: 2, capacity: 2, basePrice: 1500, seasons: [{ from: "2026-12-20", to: "2027-01-05", price: 2500, minNights: 2 }] },
  { _id: "r2", hotel: "h1", qty: 1, capacity: 4, basePrice: 2200 },
  { _id: "r3", hotel: "h2", qty: 1, capacity: 2, basePrice: 1200 },
];
let bkList = [];
Hotel.find = () => ({ select() { return this; }, lean: async () => [{ _id: "h1", slug: "rimnam" }, { _id: "h2", slug: "suanpa" }, { _id: "h3", slug: "nopin" }] });
RoomType.find = () => ({ select() { return this; }, lean: async () => rts });
Booking.find = () => ({ select() { return this; }, lean: async () => bkList });
let A = Object.fromEntries((await mapAvailability("2026-11-01", "2026-11-03", 2)).map((a) => [a.slug, a]));
t("avail: free hotel, lowest price of free rooms", A.rimnam.available && A.rimnam.from === 1500 && A.rimnam.rooms === 3 && A.suanpa.available && A.suanpa.from === 1200, A);
t("avail: hotel without rooms on sale → not available", A.nopin.available === false && A.nopin.from === null);
bkList = [{ roomType: "r1", checkin: "2026-11-01", checkout: "2026-11-02" }, { roomType: "r1", checkin: "2026-11-02", checkout: "2026-11-04" }, { roomType: "r3", checkin: "2026-10-31", checkout: "2026-11-02" }];
A = Object.fromEntries((await mapAvailability("2026-11-01", "2026-11-03", 2)).map((a) => [a.slug, a]));
t("avail: night-by-night — r1 has 1 room left, r3 full", A.rimnam.available && A.rimnam.rooms === 2 && A.rimnam.from === 1500 && A.suanpa.available === false, A);
A = Object.fromEntries((await mapAvailability("2026-11-01", "2026-11-03", 3)).map((a) => [a.slug, a]));
t("avail: enough beds for the group (2 + 4 > 3)", A.rimnam.available);
A = Object.fromEntries((await mapAvailability("2026-11-01", "2026-11-03", 7)).map((a) => [a.slug, a]));
t("avail: too many guests → not available", A.rimnam.available === false);
bkList = [];
A = Object.fromEntries((await mapAvailability("2026-12-24", "2026-12-25", 2)).map((a) => [a.slug, a]));
t("avail: season min nights skips that room, uses the next one", A.rimnam.available && A.rimnam.from === 2200 && A.rimnam.rooms === 1, A.rimnam);
A = Object.fromEntries((await mapAvailability("2026-12-24", "2026-12-26", 2)).map((a) => [a.slug, a]));
t("avail: seasonal price on check-in date", A.rimnam.from === 2200 && A.rimnam.rooms === 3, A.rimnam);

console.log(`geo: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
