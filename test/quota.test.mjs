// โควตาพื้นที่ต่อที่พัก (lib/storage.js hotelUsage/quotaError, lib/filestore.js prefixBytes/dataBytes)
// + API แอดมินตั้งโควตา · อัปรูปเกินโควตาถูกปฏิเสธ 413 · ไม่มีรูปใหม่ = ไม่ตรวจ
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
delete process.env.HOTEL_QUOTA_MB;
const SB = "https://proj.supabase.co", KEY = "service-key-xyz";
Object.assign(process.env, { SUPABASE_URL: SB, SUPABASE_SERVICE_KEY: KEY, SUPABASE_BUCKET: "media" });
const express = (await import("express")).default;
const M = {};
for (const n of ["Hotel", "RoomType", "Service", "Booking", "ActivityBooking", "PromoCode", "Review", "Feedback", "LinkCode", "User", "Staff", "ActionLog"]) M[n] = (await import(`../models/${n}.js`)).default;
const { sign } = await import("../lib/auth.js");
const { blockOperators } = await import("../lib/security.js");
const { hotelUsage, quotaError, quotaBytes } = await import("../lib/storage.js");
const { prefixBytes, dataBytes } = await import("../lib/filestore.js");
const hotelRoutes = (await import("../routes/hotels.js")).default;
const roomRoutes = (await import("../routes/rooms.js")).default;

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x) : ""); } };
const MB = 1024 * 1024, HID = "64b7f0c2a1b2c3d4e5f60718";

// ---- Supabase ปลอม: h/<HID>/ มีไฟล์ 2 MB + โฟลเดอร์ย่อย 1 MB
let listCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  if (url.startsWith("http://127.0.0.1")) return realFetch(url, opt);
  const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st });
  if (url === SB + "/storage/v1/object/list/media") {
    listCalls++;
    const { prefix } = JSON.parse(opt.body);
    if (prefix === "h/" + HID) return json([{ id: "1", name: "cover-a.jpg", metadata: { size: 2 * MB } }, { id: null, name: "old" }]);
    if (prefix === "h/" + HID + "/old") return json([{ id: "2", name: "x.jpg", metadata: { size: 1 * MB } }]);
    return json([]);
  }
  return json({ message: "unexpected " + url }, 500);
};

// ---- ฐานข้อมูลปลอม: ที่พักนี้ใช้ 4 MB (Booking 3 MB + RoomType 1 MB)
let quotaMB = undefined;
const DB = { Booking: 3 * MB, RoomType: 1 * MB };
for (const [n, Mo] of Object.entries(M)) Mo.aggregate = async (pipe) => (DB[n] && String(Object.values(pipe[0].$match)[0]) === HID ? [{ _id: null, bytes: DB[n] }] : []);
M.Hotel.findById = () => ({ select: () => ({ lean: async () => ({ storageQuotaMB: quotaMB }) }) });

t("dataBytes: only data URLs", dataBytes({ images: ["data:image/png;base64," + "A".repeat(4000), "https://x/y.jpg"], imageUrl: "" }, ["images", "imageUrl"]) === Math.round(("data:image/png;base64," + "A".repeat(4000)).length * 0.75));
t("prefixBytes: recurses folders", (await prefixBytes("h/" + HID)) === 3 * MB);
t("quotaBytes: default 20 MB", quotaBytes({}) === 20 * MB && quotaBytes({ storageQuotaMB: 50 }) === 50 * MB);
let u = await hotelUsage(HID);
t("usage: db + files", u.dbBytes === 4 * MB && u.fileBytes === 3 * MB && u.bytes === 7 * MB && u.leftBytes === 13 * MB && !u.over, u);
listCalls = 0;
t("quotaError: no new image -> skip", (await quotaError(HID, 0)) === null && listCalls === 0);
t("quotaError: fits", (await quotaError(HID, 5 * MB)) === null);
t("quotaError: over", /พื้นที่ของที่พักเต็ม/.test(await quotaError(HID, 14 * MB)));
quotaMB = 5;
u = await hotelUsage(HID);
t("usage: custom quota over", u.quotaBytes === 5 * MB && u.over && u.leftBytes === 0, u);

// ---- API
const app = express(); app.use(express.json({ limit: "12mb" })); app.use("/api", blockOperators); app.use("/api", hotelRoutes); app.use("/api", roomRoutes);
const srv = app.listen(0);
const base = "http://127.0.0.1:" + srv.address().port + "/api/";
const admin = sign({ _id: "u-admin", role: "admin" }), owner = sign({ _id: "u-owner", role: "owner", hotel: HID });
const call = async (method, path, tok, body) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
let saved = null;
M.Hotel.findByIdAndUpdate = (id, upd) => ({ select: () => ({ lean: async () => { saved = upd; return { name: "Inn", storageQuotaMB: upd.$set ? upd.$set.storageQuotaMB : undefined }; } }) });
let r = await call("PATCH", `admin/hotels/${HID}/quota`, owner, { mb: 100 });
t("quota api: owner 403", r.status === 403, r);
r = await call("PATCH", `admin/hotels/${HID}/quota`, admin, { mb: -1 });
t("quota api: bad value", r.status === 400, r);
r = await call("PATCH", `admin/hotels/${HID}/quota`, admin, { mb: "35" });
t("quota api: set", r.status === 200 && r.json.quotaMB === 35 && saved.$set.storageQuotaMB === 35, r);
r = await call("PATCH", `admin/hotels/${HID}/quota`, admin, { mb: "" });
t("quota api: reset to default", r.status === 200 && r.json.quotaMB === 20 && !r.json.custom && saved.$unset, r);
r = await call("GET", `hotels/${HID}/storage`, owner);
t("owner usage api", r.status === 200 && r.json.quotaBytes === 5 * MB && r.json.over === true, r);

// อัปรูปห้องตอนพื้นที่เต็ม → 413 (ก่อนอัปขึ้น Supabase) · แก้ห้องไม่มีรูปใหม่ → ผ่าน
M.Staff.countDocuments = async () => 0; M.ActionLog.create = async () => ({});
const RID = "64b7f0c2a1b2c3d4e5f60719";
M.RoomType.findById = async () => ({ _id: RID, hotel: HID, name: "Deluxe", images: [], imageUrl: "" });
M.RoomType.findByIdAndUpdate = async (id, upd) => ({ _id: RID, hotel: HID, ...upd.$set });
const png = "data:image/png;base64," + Buffer.from("x".repeat(2000)).toString("base64");
r = await call("PATCH", `rooms/${RID}`, owner, { images: [png] });
t("room image over quota -> 413", r.status === 413 && /เต็ม/.test(r.json.error), r);
r = await call("PATCH", `rooms/${RID}`, owner, { basePrice: 1200 });
t("room edit without image still works", r.status === 200 && r.json.basePrice === 1200, r);

srv.close();
console.log(`quota: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
