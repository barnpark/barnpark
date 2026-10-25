// เก็บรูปบน Supabase Storage (lib/filestore.js) + ย้ายรูปเดิม (lib/storage.js migrateImages) + สำรองข้อมูลรายวัน (lib/backup.js)
// ใช้ express จริง + แทนเมธอดของโมเดลด้วยที่เก็บในหน่วยความจำ + แทน fetch ด้วย Supabase ปลอม (ไม่ต้องมีฐานข้อมูล/อินเทอร์เน็ต)
import { gunzipSync } from "zlib";
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_BUCKET", "SUPABASE_BACKUP_BUCKET"]) delete process.env[k];
const SB = "https://proj.supabase.co", KEY = "service-key-xyz";
const configure = (on) => { if (on) Object.assign(process.env, { SUPABASE_URL: SB + "/", SUPABASE_SERVICE_KEY: KEY }); else { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY; } };

// ---- Supabase ปลอม
const objects = new Map(), calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  if (url.startsWith("http://127.0.0.1")) return realFetch(url, opt);
  const h = opt.headers || {}, method = opt.method || "GET";
  calls.push({ url, method, auth: h.authorization, apikey: h.apikey, type: h["content-type"], body: opt.body });
  const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st });
  if (!url.startsWith(SB + "/storage/v1/")) return json({ message: "unexpected " + url }, 500);
  if (h.authorization !== "Bearer " + KEY || h.apikey !== KEY) return json({ message: "bad key" }, 401);
  const p = decodeURIComponent(url.slice((SB + "/storage/v1/").length));
  let m;
  if ((m = /^object\/list\/([^/]+)$/.exec(p))) {
    const { prefix } = JSON.parse(opt.body), pre = m[1] + "/" + prefix + "/";
    return json([...objects.keys()].filter((k) => k.startsWith(pre)).map((k) => ({ id: k, name: k.slice(pre.length), metadata: { size: objects.get(k).buf.length }, updated_at: "2026-10-22T00:00:00Z" })));
  }
  if ((m = /^object\/sign\/(.+)$/.exec(p))) return objects.has(m[1]) ? json({ signedURL: "/object/sign/" + m[1] + "?token=t0k" }) : json({ message: "Object not found" }, 404);
  if ((m = /^object\/([^/]+)$/.exec(p)) && method === "DELETE") { for (const x of JSON.parse(opt.body).prefixes) objects.delete(m[1] + "/" + x); return json([]); }
  if ((m = /^object\/(.+)$/.exec(p)) && method === "POST") { objects.set(m[1], { buf: Buffer.from(opt.body), type: h["content-type"] }); return json({ Key: m[1] }); }
  if ((m = /^object\/(.+)$/.exec(p)) && method === "DELETE") { objects.delete(m[1]); return json({}); }
  return json({ message: "unknown" }, 400);
};

const express = (await import("express")).default;
// รหัสพนักงาน (lib/team.js): ที่พักยังไม่ตั้งทีม → ทำรายการได้โดยไม่ต้องใส่รหัส · ไม่บันทึกประวัติจริง
const TeamStaff = (await import("../models/Staff.js")).default; TeamStaff.countDocuments = async () => 0;
const TeamLog = (await import("../models/ActionLog.js")).default; TeamLog.create = async () => ({});
const M = {};
for (const n of ["Hotel", "RoomType", "Service", "User", "Booking", "ActivityBooking", "Feedback", "PromoCode", "Review"]) M[n] = (await import(`../models/${n}.js`)).default;
const { sign } = await import("../lib/auth.js");
const { blockOperators } = await import("../lib/security.js");
const FS = await import("../lib/filestore.js");
const { runBackup, KEEP_BACKUPS } = await import("../lib/backup.js");
const app = express(); app.use(express.json({ limit: "10mb" })); app.use("/api", blockOperators);
for (const f of ["rooms", "services", "hotels"]) app.use("/api", (await import(`../routes/${f}.js`)).default);

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };

// ---- ที่เก็บในหน่วยความจำแทน MongoDB
const HID = "64b7f0c2a1b2c3d4e5f60718", OTHER = "64b7f0c2a1b2c3d4e5f60719";
const db = { RoomType: new Map(), Service: new Map(), Hotel: new Map() };
const clone = (o) => JSON.parse(JSON.stringify(o));
const isData = (v) => typeof v === "string" && /^data:image\//.test(v);
const FIELDS = { RoomType: ["images", "imageUrl"], Service: ["imageUrl"], Hotel: ["coverData", "logoData", "coverUrl", "logoUrl", "promoImage"] };
const hasData = (n, d) => FIELDS[n].some((f) => (Array.isArray(d[f]) ? d[f].some(isData) : isData(d[f])));
const q = (v) => { const p = Promise.resolve(v); return Object.assign(p, { select: () => q(v), lean: () => q(v), sort: () => q(v), limit: () => q(v) }); };
for (const n of ["RoomType", "Service", "Hotel"]) {
  const S = db[n];
  M[n].create = async (b) => { const d = { ...clone(b), _id: String(b._id), updatedAt: new Date().toISOString() }; S.set(d._id, d); return d; };
  M[n].findById = (id) => { const d = S.get(String(id)); return q(d ? { ...clone(d), deleteOne: async () => S.delete(String(id)) } : null); };
  M[n].findByIdAndUpdate = (id, upd, opt = {}) => {
    const d = S.get(String(id)); if (!d) return q(null);
    const old = clone(d); Object.assign(d, upd.$set || (upd.$unset ? {} : upd)); for (const k of Object.keys(upd.$unset || {})) delete d[k];
    d.updatedAt = new Date(Date.now() + 1).toISOString();
    return q(opt.new ? clone(d) : old);
  };
  M[n].updateOne = async (w, upd) => {
    const d = S.get(String(w._id)); if (!d || (w.updatedAt && w.updatedAt !== d.updatedAt)) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(d, clone(upd.$set)); d.updatedAt = new Date(Date.now() + 5).toISOString(); return { matchedCount: 1, modifiedCount: 1 };
  };
  M[n].find = (w = {}) => {
    let list = [...S.values()];
    if (w.$or) list = list.filter((d) => hasData(n, d));
    if (w._id && w._id.$gt) list = list.filter((d) => d._id > w._id.$gt);
    list.sort((a, b) => (a._id < b._id ? -1 : 1));
    let lim = Infinity;
    const chain = { sort: () => chain, select: () => chain, limit: (x) => { lim = x; return chain; }, lean: async () => clone(list.slice(0, lim)) };
    return chain;
  };
  M[n].aggregate = async () => { // จำลองผลนับของ pipeline ใน migrateImages
    let docs = 0, images = 0, bytes = 0;
    for (const d of S.values()) { const v = FIELDS[n].flatMap((f) => (Array.isArray(d[f]) ? d[f] : [d[f]])).filter(isData); if (v.length) { docs++; images += v.length; bytes += v.reduce((s, x) => s + Buffer.byteLength(x), 0); } }
    return docs ? [{ docs, images, bytes }] : [];
  };
}

const srv = app.listen(0);
const base = "http://127.0.0.1:" + srv.address().port + "/api/";
const admin = sign({ _id: "u-admin", role: "admin" }), owner = sign({ _id: "u-owner", role: "owner", hotel: HID });
const call = async (method, path, tok, body) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const img = (s, type = "jpeg") => `data:image/${type};base64,` + Buffer.from(s).toString("base64");
const PUB = SB + "/storage/v1/object/public/barnpark-media/";
const uploads = () => calls.filter((c) => c.method === "POST" && /\/storage\/v1\/object\/barnpark-media\//.test(c.url));
const deletes = () => calls.filter((c) => c.method === "DELETE");

// ===== 1) ยังไม่ตั้ง Supabase → เก็บ data URL เหมือนเดิม
t("not ready", FS.storeReady() === false);
let r = await call("POST", `hotels/${HID}/rooms`, owner, { name: "ห้องเดิม", basePrice: 900, images: [img("A")], imageUrl: img("A") });
t("off: room saved", r.status === 200 && r.json.images[0] === img("A") && r.json.imageUrl === img("A"), r);
t("off: no fetch", calls.length === 0, calls);
const OFF_ROOM = r.json._id;
r = await call("POST", `hotels/${HID}/services`, owner, { name: "จักรยาน", price: 100, imageUrl: img("S", "png") });
t("off: service data url", r.status === 200 && r.json.imageUrl === img("S", "png"));
const OFF_SVC = r.json._id;
db.Hotel.set(HID, { _id: HID, name: "Test Inn", slug: "test-inn", coverData: img("COVER"), coverUrl: `/api/public/img/cover/${HID}/0?v=1`, logoUrl: "", updatedAt: "2026-10-01T00:00:00.000Z", lineChannelToken: "LINE-TOKEN-SECRET", lineChannelSecret: "LINE-SECRET" });

// ===== 2) ตั้ง Supabase แล้ว → อัปโหลด + เก็บลิงก์ https
configure(true);
t("ready", FS.storeReady() === true && FS.storeInfo().bucket === "barnpark-media" && FS.storeInfo().backupBucket === "barnpark-backups");
r = await call("POST", `hotels/${HID}/rooms`, owner, { name: "ห้องใหม่", basePrice: 1200, images: [img("B"), img("C")], imageUrl: img("B") });
const RID = r.json && r.json._id;
t("on: room 200", r.status === 200, r);
t("on: images are our https urls", r.json.images.every((u) => u.startsWith(PUB + `h/${HID}/room-${RID}-`)) && r.json.imageUrl === r.json.images[0], r.json);
t("on: same image uploaded once", uploads().length === 2, uploads().map((c) => c.url));
const up = uploads()[0];
t("on: upload headers", up.auth === "Bearer " + KEY && up.apikey === KEY && up.type === "image/jpeg", up);
t("on: upload path", /\/storage\/v1\/object\/barnpark-media\/h\/[a-f0-9]{24}\/room-[a-f0-9]{24}-[a-f0-9]{16}\.jpg$/.test(up.url), up.url);
t("on: object stored", objects.get("barnpark-media/" + r.json.images[0].slice(PUB.length)).buf.toString() === "B");
t("on: no data url in db", !JSON.stringify(db.RoomType.get(RID)).includes("data:image"));
const [urlB, urlC] = r.json.images;

// ===== 3) เปลี่ยนรูป → ลบไฟล์เดิม · ลิงก์ของที่พักอื่นห้ามลบ
calls.length = 0;
r = await call("PATCH", `rooms/${RID}`, owner, { images: [urlC, img("D")], imageUrl: urlC });
t("replace: 200", r.status === 200 && r.json.images[0] === urlC && r.json.images[1].startsWith(PUB), r);
t("replace: old object deleted", deletes().length === 1 && decodeURIComponent(deletes()[0].url).endsWith(urlB.slice(PUB.length)) && !objects.has("barnpark-media/" + urlB.slice(PUB.length)), deletes());
t("replace: kept object stays", objects.has("barnpark-media/" + urlC.slice(PUB.length)));
const foreign = PUB + `h/${OTHER}/room-64b7f0c2a1b2c3d4e5f60000-0123456789abcdef.jpg`;
objects.set("barnpark-media/" + foreign.slice(PUB.length), { buf: Buffer.from("x") });
await call("PATCH", `rooms/${RID}`, owner, { images: [foreign] });
calls.length = 0;
await call("PATCH", `rooms/${RID}`, owner, { images: [] });
t("scope: other hotel's file not deleted", objects.has("barnpark-media/" + foreign.slice(PUB.length)) && !deletes().some((c) => c.url.includes(OTHER)), deletes());
r = await call("PATCH", `rooms/${RID}`, owner, { images: ["javascript:alert(1)"] });
t("validation kept", r.status === 400, r);
calls.length = 0;
r = await call("DELETE", `rooms/${RID}`, owner);
t("delete room ok", r.status === 200);

// ===== 4) รูปปกจากเว็บหลังบ้าน (sharp) → Supabase + ลบปกเดิม
const sharp = (await import("sharp")).default;
const png = await sharp({ create: { width: 8, height: 4, channels: 3, background: "#e11d48" } }).png().toBuffer();
r = await call("POST", `hotels/${HID}/cover`, owner, { image: "data:image/png;base64," + png.toString("base64") });
const cover1 = r.json && r.json.coverUrl;
t("cover: https", r.status === 200 && cover1.startsWith(PUB + `h/${HID}/cover-`) && cover1.endsWith(".jpg") && db.Hotel.get(HID).coverData === cover1, r);
const png2 = await sharp({ create: { width: 8, height: 4, channels: 3, background: "#2563eb" } }).png().toBuffer();
r = await call("POST", `hotels/${HID}/cover`, owner, { image: "data:image/png;base64," + png2.toString("base64") });
t("cover: old removed", r.status === 200 && r.json.coverUrl !== cover1 && !objects.has("barnpark-media/" + cover1.slice(PUB.length)), r);
db.Hotel.get(HID).coverData = img("COVER"); db.Hotel.get(HID).coverUrl = `/api/public/img/cover/${HID}/0?v=1`; // กลับเป็นรูปในฐานข้อมูลไว้ทดสอบการย้าย

// ===== 5) ย้ายรูปเดิม (dry run → ทำจริงทีละชุด → รันซ้ำ)
r = await call("POST", "admin/storage/migrate-images", owner, { dryRun: true }); t("migrate: owner 403", r.status === 403, r);
r = await call("POST", "admin/storage/migrate-images", null, { dryRun: true }); t("migrate: no token 401", r.status === 401, r);
r = await call("POST", "admin/storage/migrate-images", admin, { dryRun: true });
t("migrate: dry run counts", r.status === 200 && r.json.dryRun && r.json.found.docs === 3 && r.json.found.images === 4 && r.json.byKind.room.images === 2, r.json);
t("migrate: dry run uploads nothing", db.RoomType.get(OFF_ROOM).imageUrl === img("A"));
calls.length = 0;
let after = {}, moved = 0, freed = 0, rounds = 0, res;
do { res = (await call("POST", "admin/storage/migrate-images", admin, { dryRun: false, limit: 1, after })).json; after = res.after; moved += res.moved; freed += res.bytesFreed; rounds++; } while (!res.done && rounds < 10);
t("migrate: moved all", moved === 4 && res.failed === 0, { moved, res });
t("migrate: batches", rounds >= 3, rounds);
t("migrate: bytes freed", freed === Buffer.byteLength(img("A")) * 2 + Buffer.byteLength(img("S", "png")) + Buffer.byteLength(img("COVER")), freed);
const room0 = db.RoomType.get(OFF_ROOM), hotel0 = db.Hotel.get(HID);
t("migrate: room urls", room0.images[0].startsWith(PUB + `h/${HID}/room-${OFF_ROOM}-`) && room0.imageUrl === room0.images[0], room0);
t("migrate: service png", db.Service.get(OFF_SVC).imageUrl.startsWith(PUB) && db.Service.get(OFF_SVC).imageUrl.endsWith(".png"));
t("migrate: cover + coverUrl", hotel0.coverData.startsWith(PUB + `h/${HID}/cover-`) && hotel0.coverUrl === hotel0.coverData, hotel0);
t("migrate: uploaded once per image", uploads().length === 3, uploads().length);
r = await call("POST", "admin/storage/migrate-images", admin, { dryRun: true });
t("migrate: nothing left", r.json.found.images === 0, r.json);
r = await call("POST", "admin/storage/migrate-images", admin, { dryRun: false });
t("migrate: re-run safe", r.status === 200 && r.json.moved === 0 && r.json.done, r.json);
configure(false);
r = await call("POST", "admin/storage/migrate-images", admin, { dryRun: false });
t("migrate: not configured 400", r.status === 400 && /Supabase/.test(r.json.error), r);
r = await call("GET", "admin/storage", owner); t("storage: owner 403", r.status === 403);
configure(true);

// ===== 6) สำรองข้อมูล
M.Hotel.find = () => q([{ ...clone(db.Hotel.get(HID)) }]); // สมมุติว่ามีความลับหลุดมาใน query
M.User.find = () => q([{ _id: "u1", email: "o@x.th", passwordHash: "HASH", otpHash: "OTP", resetHash: "RESET" }]);
for (const n of ["RoomType", "Booking", "Service", "ActivityBooking", "Feedback", "PromoCode", "Review"]) M[n].find = () => q([{ _id: n + "1", note: n }]);
for (const p of ["backups", "backups/x/link"]) {
  r = await call("GET", "admin/" + p, owner); t("backup: owner 403 " + p, r.status === 403, r);
}
r = await call("POST", "admin/backups", owner); t("backup: owner POST 403", r.status === 403, r);
for (let i = 1; i <= 31; i++) objects.set(`barnpark-backups/daily/2026-08-${String(i).padStart(2, "0")}.json.gz`, { buf: Buffer.from("old") });
objects.set("barnpark-backups/daily/notes.txt", { buf: Buffer.from("keep") });
r = await call("POST", "admin/backups", admin);
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
t("backup: ok", r.status === 200 && r.json.path === `daily/${today}.json.gz` && r.json.bytes > 0, r);
const file = objects.get(`barnpark-backups/daily/${today}.json.gz`);
t("backup: gzip type", file && file.type === "application/gzip", file && file.type);
const data = JSON.parse(gunzipSync(file.buf).toString());
t("backup: round trip", data.hotels[0].slug === "test-inn" && data.rooms[0].note === "RoomType" && data.promoCodes.length === 1 && data.reviews.length === 1, data);
const txt = JSON.stringify(data);
t("backup: no secrets", !/LINE-TOKEN-SECRET|LINE-SECRET|HASH|OTP|RESET|lineChannelToken|passwordHash|otpHash|resetHash/.test(txt), txt.slice(0, 300));
const daily = [...objects.keys()].filter((k) => /^barnpark-backups\/daily\/\d{4}-\d\d-\d\d\.json\.gz$/.test(k)).sort();
t("backup: keeps newest 30", daily.length === KEEP_BACKUPS && r.json.removed === 2 && !objects.has("barnpark-backups/daily/2026-08-01.json.gz") && !objects.has("barnpark-backups/daily/2026-08-02.json.gz") && objects.has("barnpark-backups/daily/2026-08-03.json.gz"), { n: daily.length, removed: r.json.removed });
t("backup: other files untouched", objects.has("barnpark-backups/daily/notes.txt"));
r = await call("GET", "admin/backups", admin);
t("backup: list newest first", r.status === 200 && r.json.ready && r.json.list[0].name === `${today}.json.gz` && r.json.list.length === 30, r.json);
r = await call("GET", `admin/backups/${today}.json.gz/link`, admin);
t("backup: signed link", r.status === 200 && r.json.url === `${SB}/storage/v1/object/sign/barnpark-backups/daily/${today}.json.gz?token=t0k`, r);
r = await call("GET", "admin/backups/..%2F..%2Fsecret/link", admin);
t("backup: bad name 400", r.status === 400, r);
r = await call("GET", "admin/export", admin);
t("export: same shape, no secrets", r.status === 200 && r.json.hotels.length === 1 && r.json.promoCodes === undefined && !JSON.stringify(r.json).includes("LINE-TOKEN-SECRET"), r.json && Object.keys(r.json));
t("key never in errors", !JSON.stringify(calls.map((c) => c.url)).includes(KEY));
configure(false);
t("backup: skipped when off", (await runBackup()).skipped !== undefined);

srv.close();
console.log(`filestore: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
