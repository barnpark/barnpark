// กิจกรรมท้องถิ่นบนหน้าแรก (lib/activity.js activitiesForHome, GET /api/public/activities)
// + หน้านโยบายความเป็นส่วนตัวรายที่พัก (GET /api/public/privacy/:slug) — ไม่ต้องมีฐานข้อมูล
const realFetch = globalThis.fetch;
const express = (await import("express")).default;
const M = {};
for (const n of ["Hotel", "Service"]) M[n] = (await import(`../models/${n}.js`)).default;
const { activitiesForHome, HOME_ACT_MAX } = await import("../lib/activity.js");
const publicRoutes = (await import("../routes/public.js")).default;

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
// เหมือน mongoose: .select("a b") คืนเฉพาะช่องที่เลือก (+ _id) — ถ้าโค้ดลืมเลือกช่องที่ใช้กรอง เทสต์จะเห็น
const pick = (o, f) => { if (!o || !f) return o; const k = ["_id", ...f.split(/\s+/).filter(Boolean)]; return Object.fromEntries(Object.entries(o).filter(([x]) => k.includes(x))); };
const q = (v) => { let f = null; return { select(s) { f = s; return this; }, sort() { return this; }, lean: async () => { const r = typeof v === "function" ? v() : v; return Array.isArray(r) ? r.map((o) => pick(o, f)) : pick(r, f); }, then(a, b) { return this.lean().then(a, b); } }; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const HA = "64b7f0c2a1b2c3d4e5f60701", HB = "64b7f0c2a1b2c3d4e5f60702";
let hotels = [
  { _id: HA, name: "บ้านริมน้ำ", slug: "rimnam", location: "เชียงใหม่" },
  { _id: HB, name: "สวนป่า", slug: "suanpa", location: "กาญจนบุรี" },
];
const sv = (id, hotel, extra = {}) => ({ _id: "65000000000000000000" + id, hotel, name: "กิจกรรม " + id, price: 400, saleMode: "standalone", ...extra });
let services = [
  sv("0a01", HA, { imageUrl: "https://www.facebook.com/p/somepage/", times: ["09:00", "25:99", "14:00"] }),
  sv("0a02", HA, { imageUrl: "data:image/png;base64,AAAA", saleMode: "both", description: "x".repeat(300) }),
  sv("0a03", HA, { imageUrl: "https://cdn.example/a.jpg", unit: "ต่อกลุ่ม" }),
  sv("0a04", HA, { saleMode: "addon" }),          // ขายพ่วงห้องอย่างเดียว → ไม่ขึ้นหน้าแรก
  sv("0a05", HA, { hidden: true }),               // ปิดขาย → ไม่ขึ้น
  sv("0a06", HA, { name: "  " }),                 // ไม่มีชื่อ → ไม่ขึ้น
  sv("0b01", HB, { price: -50 }),
  { ...sv("0c01", "64b7f0c2a1b2c3d4e5f60799") },  // ที่พักที่ไม่ได้ขึ้นแผนที่
];
let hotelQ = null, svcQ = null, svcCalls = 0;
M.Hotel.find = (f) => { hotelQ = f; return q(() => hotels.map((h) => ({ ...h }))); };
M.Service.find = (f) => { svcQ = f; svcCalls++; return q(() => services.map((s) => ({ ...s }))); };

// ---- รายการกิจกรรม
let list = await activitiesForHome({ fresh: true });
t("only listed properties (approved, not paused, on the map)", eq(hotelQ, { approved: { $ne: false }, status: { $ne: "paused" }, onMap: { $ne: false } }), hotelQ);
t("only activities sold on their own and not hidden", svcQ.hidden.$ne === true && eq(svcQ.saleMode.$in, ["standalone", "both"]) && eq(svcQ.hotel.$in, [HA, HB]), svcQ);
t("add-on only, hidden, unnamed and unknown-property activities left out", eq(list.map((a) => a.id.slice(-4)), ["0a01", "0b01", "0a02", "0a03"]), list.map((a) => a.id));
t("one activity per property per round (A, B, A, A)", list[0].hotel.slug === "rimnam" && list[1].hotel.slug === "suanpa" && list[2].hotel.slug === "rimnam");
t("only the fields the homepage needs", list.every((a) => eq(Object.keys(a).sort(), ["description", "hotel", "id", "image", "name", "price", "times", "unit"]) && eq(Object.keys(a.hotel).sort(), ["location", "name", "slug"])), Object.keys(list[0]));
const by = Object.fromEntries(list.map((a) => [a.id.slice(-4), a]));
t("a Facebook page as the picture → no picture", by["0a01"].image === "");
t("stored picture → served from the image route, not inlined", by["0a02"].image === `/api/public/img/svc/${services[1]._id}/0`, by["0a02"].image);
t("https picture kept", by["0a03"].image === "https://cdn.example/a.jpg");
t("bad round times dropped", eq(by["0a01"].times, ["09:00", "14:00"]), by["0a01"].times);
t("long description cut", by["0a02"].description.length === 140 && by["0a02"].description.endsWith("…"));
t("unit passed, default per person", by["0a03"].unit === "ต่อกลุ่ม" && by["0a01"].unit === "ต่อท่าน");
t("negative price shown as 0", by["0b01"].price === 0);

// ---- ไม่เกิน HOME_ACT_MAX · แคช
services = Array.from({ length: 40 }, (_, i) => sv(String(1000 + i), i % 2 ? HA : HB));
list = await activitiesForHome({ fresh: true });
t("capped at " + HOME_ACT_MAX, list.length === HOME_ACT_MAX, list.length);
const calls = svcCalls;
const again = await activitiesForHome();
t("cached for a minute (no new query)", svcCalls === calls && again === list);
hotels = [];
t("no listed properties → empty list", (await activitiesForHome({ fresh: true })).length === 0);

// ---- API สาธารณะ
let found = { _id: HA, name: "บ้านริมน้ำ <b>", slug: "rimnam", phone: "081-111-1111", lineId: "@rimnam", notifyEmail: "owner@rimnam.test", lineChannelToken: "SECRET-TOKEN" };
let slugAsked = null;
M.Hotel.findOne = (f) => { slugAsked = f.slug; return q(() => (found && f.slug === found.slug ? { ...found } : null)); };
const app = express(); app.use(express.json()); app.use("/api/public", publicRoutes);
const srv = app.listen(0); await new Promise((r) => srv.once("listening", r));
const base = "http://127.0.0.1:" + srv.address().port;
const get = async (u) => { const r = await realFetch(base + u); return { status: r.status, json: await r.json().catch(() => null), cc: r.headers.get("cache-control") }; };

let r = await get("/api/public/activities");
t("GET /activities: list + short public cache", r.status === 200 && Array.isArray(r.json) && r.cc === "public, max-age=60", r);
r = await get("/api/public/privacy/rimnam");
t("GET /privacy/:slug: name, email, phone, LINE", r.status === 200 && r.json.name === "บ้านริมน้ำ <b>" && r.json.email === "owner@rimnam.test" && r.json.phone === "081-111-1111" && /line\.me/.test(r.json.lineUrl) && r.json.lineLabel === "@rimnam", r.json);
t("privacy: only contact fields (no tokens)", eq(Object.keys(r.json).sort(), ["email", "lineLabel", "lineUrl", "name", "phone", "slug"]) && !JSON.stringify(r.json).includes("SECRET"), r.json);
found = { ...found, notifyEmail: "not an email", lineId: "" };
r = await get("/api/public/privacy/rimnam");
t("privacy: a broken email is not shown", r.status === 200 && r.json.email === "" && r.json.lineUrl === "", r.json);
r = await get("/api/public/privacy/nope");
t("privacy: unknown property → 404", r.status === 404);
await get("/api/public/privacy/%40753ctjdq");
t("privacy: slug passed as a plain string", slugAsked === "@753ctjdq", slugAsked);
srv.close();

console.log(`home activities: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
