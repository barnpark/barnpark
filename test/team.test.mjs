// รหัสพนักงาน: ใครทำอะไร (lib/team.js, routes/team.js) + การตรวจรหัส/สิทธิ์ในเส้นทางที่แก้ข้อมูล
// ใช้ express จริง + ตัวปลอมของโมเดลในหน่วยความจำ (ไม่ต้องมีฐานข้อมูล)
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
const express = (await import("express")).default;
const bcrypt = (await import("bcryptjs")).default;
const Staff = (await import("../models/Staff.js")).default;
const ActionLog = (await import("../models/ActionLog.js")).default;
const User = (await import("../models/User.js")).default;
const Booking = (await import("../models/Booking.js")).default;
const RoomType = (await import("../models/RoomType.js")).default;
const { sign } = await import("../lib/auth.js");
const { blockOperators } = await import("../lib/security.js");
const { validPin, allowed, pinFailed, pinLocked, pinReset, pinKey } = await import("../lib/team.js");
const teamRoutes = (await import("../routes/team.js")).default;
const bookingRoutes = (await import("../routes/bookings.js")).default;

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ---- ตรรกะล้วน
t("pin: 4-6 digits", validPin("1234") && validPin("123456") && !validPin("123") && !validPin("1234567") && !validPin("12a4") && !validPin(""));
t("allowed: manager all", allowed({ manager: true }, "manager") && allowed({ manager: true }, "rooms"));
t("allowed: staff perms", allowed({ perms: ["desk"] }, "desk") && allowed({ perms: ["desk"] }, ["bookings", "desk"]) && !allowed({ perms: ["desk"] }, "bookings") && !allowed({ perms: ["desk"] }, "manager"));
t("pinKey: per hotel", pinKey("h1", "1234") !== pinKey("h2", "1234") && pinKey("h1", "1234") === pinKey("h1", "1234"));
for (let i = 0; i < 7; i++) pinFailed("hx", 1000);
t("lock: not before 8", !pinLocked("hx", 1000));
pinFailed("hx", 1000); t("lock: after 8 wrong", pinLocked("hx", 2000));
t("lock: expires after 5 min", !pinLocked("hx", 1000 + 5 * 60e3 + 1));
pinReset("hx");

// ---- ตัวปลอมของโมเดล (ค้นแบบง่าย: เทียบค่าตรง ๆ + $ne)
const HID = "64b7f0c2a1b2c3d4e5f60718", OTHER = "64b7f0c2a1b2c3d4e5f60000", BID = "64b7f0c2a1b2c3d4e5f6071b", RID = "64b7f0c2a1b2c3d4e5f60719";
let seq = 0; const oid = () => "64b7f0c2a1b2c3d4e5f7" + String(++seq).padStart(4, "0");
let staff = [];
const match = (d, q) => Object.entries(q).every(([k, v]) => (v && typeof v === "object" && "$ne" in v ? String(d[k]) !== String(v.$ne) : String(d[k]) === String(v)));
const q = (v) => Object.assign(Promise.resolve(v), { lean: async () => v, select: () => ({ lean: async () => v }), sort: () => ({ lean: async () => v }) });
const doc = (d) => Object.assign(d, { save: async function () { const i = staff.findIndex((x) => x._id === this._id); staff[i] = this; return this; } });
Staff.countDocuments = async (f) => staff.filter((s) => match(s, f)).length;
Staff.findOne = (f) => q(staff.find((s) => match(s, f)) || null);
Staff.find = (f) => q(staff.filter((s) => match(s, f)));
Staff.findById = (id) => q(staff.find((s) => s._id === String(id)) || null);
Staff.create = async (d) => { const s = doc({ _id: oid(), active: true, perms: [], ...d, hotel: String(d.hotel) }); staff.push(s); return s; };
Staff.deleteOne = async (f) => { staff = staff.filter((s) => s._id !== String(f._id)); return {}; };
Staff.updateOne = async () => ({});
const logs = [];
ActionLog.create = async (d) => { logs.push({ ...d, createdAt: new Date() }); return d; };
ActionLog.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => logs.slice().reverse() }) }) });
const ownerHash = bcrypt.hashSync("owner-pass-123", 4);
User.findById = (id) => ({ select: async () => (String(id) === "u-owner" ? { _id: "u-owner", email: "owner@x.com", passwordHash: ownerHash } : null) });
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const plus = (n) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let bk = { _id: BID, hotel: HID, roomType: RID, ref: "BP-ABC123", status: "confirmed", stay: "", checkin: today, checkout: plus(1), guestName: "Ann", payStatus: "unpaid", amount: 900 };
Booking.findById = (id) => q(String(id) === BID ? { ...bk } : null);
Booking.find = () => q(bk.status === "cancelled" ? [] : [{ ...bk }]); // ห้องอื่นในเลขจองเดียวกัน (ยกเลิก/ห้องซ้อน)
Booking.findByIdAndUpdate = async (_id, upd) => { bk = { ...bk, ...(upd.$set || upd) }; for (const k of Object.keys(upd.$unset || {})) delete bk[k]; return bk; };
RoomType.findById = () => q({ _id: RID, hotel: HID, qty: 1, units: [] });

const app = express(); app.use(express.json()); app.use("/api", blockOperators); app.use("/api", teamRoutes); app.use("/api", bookingRoutes);
const srv = app.listen(0);
const base = "http://127.0.0.1:" + srv.address().port + "/api/";
const owner = sign({ _id: "u-owner", role: "owner", hotel: HID }), stranger = sign({ _id: "u-x", role: "owner", hotel: OTHER }), admin = sign({ _id: "u-admin", role: "admin" });
const call = async (method, path, tok, body, pin) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + tok, ...(pin ? { "x-staff-pin": pin } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// ยังไม่ตั้งทีม → ทำงานได้เหมือนเดิม บันทึกว่า "เจ้าของ"
let r = await call("POST", `bookings/${BID}/stay`, owner, { action: "in" });
t("no team: works without pin", r.status === 200 && r.json.checkedInBy === "เจ้าของ", r);
t("no team: logged as owner", logs.at(-1).name === "เจ้าของ" && logs.at(-1).action === "stay.in", logs.at(-1));
r = await call("POST", `bookings/${BID}/stay`, owner, { action: "undo" });

// สร้างทีม
r = await call("POST", `hotels/${HID}/team`, owner, { name: "Fon", pin: "1111", manager: false });
t("team: first must be manager", r.status === 400, r);
r = await call("POST", `hotels/${HID}/team`, owner, { name: "Bell", pin: "12", manager: true });
t("team: pin format", r.status === 400, r);
r = await call("POST", `hotels/${HID}/team`, owner, { name: "Bell", pin: "9999", manager: true });
t("team: create manager", r.status === 200 && r.json.manager === true, r);
t("team: pin not returned/stored raw", !JSON.stringify(r.json).includes("9999") && !JSON.stringify(staff).includes('"9999"'));
r = await call("POST", `hotels/${HID}/team`, owner, { name: "Fon", pin: "1111", perms: ["desk", "nope"] });
t("team: now needs manager pin", r.status === 428 && r.json.needPin, r);
r = await call("POST", `hotels/${HID}/team`, owner, { name: "Fon", pin: "1111", perms: ["desk", "nope"] }, "9999");
t("team: add staff with manager pin", r.status === 200 && JSON.stringify(r.json.perms) === '["desk"]', r);
const fon = r.json.id;
r = await call("POST", `hotels/${HID}/team`, owner, { name: "Dup", pin: "1111" }, "9999");
t("team: duplicate pin 409", r.status === 409, r);
r = await call("POST", `hotels/${HID}/team`, owner, { name: "Ton", pin: "2222" }, "1111");
t("team: staff pin cannot manage team", r.status === 403 && /ผู้จัดการ/.test(r.json.error), r);
r = await call("GET", `hotels/${HID}/team`, stranger);
t("team: other hotel 403", r.status === 403, r);
r = await call("PATCH", `team/${fon}`, stranger, { active: false }, "9999");
t("team: other hotel cannot edit", r.status === 403, r);

// รหัสในเส้นทางที่แก้ข้อมูล
r = await call("POST", `bookings/${BID}/stay`, owner, { action: "in" });
t("stay: missing pin 428", r.status === 428 && r.json.needPin, r);
r = await call("POST", `bookings/${BID}/stay`, owner, { action: "in" }, "0000");
t("stay: wrong pin 403 (not 401)", r.status === 403 && r.json.needPin && /ไม่ถูกต้อง/.test(r.json.error), r);
t("stay: nothing changed yet", bk.stay === "", bk);
r = await call("POST", `bookings/${BID}/stay`, owner, { action: "in" }, "1111");
t("stay: Fon checks in", r.status === 200 && r.json.stay === "in" && r.json.checkedInBy === "Fon", r);
t("stay: logged who", logs.at(-1).name === "Fon" && logs.at(-1).action === "stay.in" && logs.at(-1).ref === "BP-ABC123", logs.at(-1));
r = await call("PATCH", `bookings/${BID}`, owner, { guestName: "Hacker" }, "1111");
t("edit booking: desk-only staff blocked", r.status === 403 && /ไม่มีสิทธิ์/.test(r.json.error) && bk.guestName === "Ann", r);
r = await call("PATCH", `bookings/${BID}`, owner, { payStatus: "paid", payMethod: "cash" }, "1111");
t("mark paid: desk staff allowed", r.status === 200 && r.json.paidBy === "Fon", r);
t("mark paid: logged", logs.at(-1).action === "booking.paid" && logs.at(-1).name === "Fon", logs.at(-1));
r = await call("POST", `bookings/${BID}/cancel`, owner, {}, "1111");
t("cancel: desk staff blocked", r.status === 403, r);
r = await call("POST", `bookings/${BID}/stay`, admin, { action: "out" });
t("admin: no pin needed", r.status === 200 && r.json.checkedOutBy === "แอดมิน Barn Park", r);

// ผู้จัดการคนสุดท้าย
const bell = staff.find((s) => s.name === "Bell")._id;
r = await call("PATCH", `team/${bell}`, owner, { active: false }, "9999");
t("last manager cannot be disabled", r.status === 400, r);
r = await call("PATCH", `team/${bell}`, owner, { manager: false }, "9999");
t("last manager cannot be demoted", r.status === 400, r);
r = await call("DELETE", `team/${bell}`, owner, null, "9999");
t("last manager cannot be deleted", r.status === 400, r);
r = await call("PATCH", `team/${fon}`, owner, { active: false }, "9999");
t("disable staff", r.status === 200 && r.json.active === false, r);
r = await call("POST", `bookings/${BID}/stay`, owner, { action: "undo" }, "1111");
t("disabled pin rejected", r.status === 403 && r.json.needPin, r);

// ลืมรหัสผู้จัดการ
r = await call("POST", `hotels/${HID}/team/recover`, owner, { password: "wrong", id: bell, pin: "5555" });
t("recover: wrong owner password", r.status === 403, r);
r = await call("POST", `hotels/${HID}/team/recover`, owner, { password: "owner-pass-123", id: bell, pin: "5555" });
t("recover: new manager pin", r.status === 200, r);
r = await call("GET", `hotels/${HID}/actions`, owner, null, "9999");
t("recover: old pin dead", r.status === 403, r);

// ประวัติ
r = await call("GET", `hotels/${HID}/actions`, owner);
t("log: needs pin", r.status === 428, r);
pinReset(HID);
r = await call("GET", `hotels/${HID}/actions`, owner, null, "5555");
t("log: manager reads", r.status === 200 && r.json.some((a) => a.name === "Fon" && a.label === "เช็คอิน"), r.json && r.json.slice(0, 3));

// กันเดารหัส
pinReset(HID);
for (let i = 0; i < 8; i++) await call("POST", `bookings/${BID}/stay`, owner, { action: "undo" }, "000" + (i % 10));
r = await call("POST", `bookings/${BID}/stay`, owner, { action: "undo" }, "5555");
t("brute force: locked even with right pin", r.status === 429, r);
pinReset(HID);

// ยอดเงิน: ตั้งทีมแล้ว → ซ่อนยอดที่จ่ายแล้ว เห็นเฉพาะยอดค้างจ่าย · รหัสผู้จัดการ/สิทธิ์รายงาน = เห็นหมด
const fon2 = await call("PATCH", `team/${fon}`, owner, { active: true }, "5555");
t("money: re-enable Fon", fon2.status === 200, fon2);
const LIST = [
  { _id: "a1", hotel: HID, status: "confirmed", payStatus: "paid", amount: 2500, discount: 100, addonTotal: 300, addons: [{ name: "นวด", price: 300, qty: 1 }] },
  { _id: "a2", hotel: HID, status: "confirmed", payStatus: "unpaid", amount: 1800, addonTotal: 200 },
  { _id: "a3", hotel: HID, status: "cancelled", payStatus: "", amount: 900 },
];
Booking.find = () => ({ sort: async () => LIST.map((x) => ({ ...x })) });
r = await call("GET", `hotels/${HID}/bookings`, owner);
t("money: paid hidden", r.status === 200 && r.json[0].amount === null && r.json[0].discount === null && r.json[0].addons[0].price === null && r.json[0].moneyHidden === true, r.json && r.json[0]);
t("money: unpaid visible (to collect)", r.json[1].amount === 1800 && r.json[1].addonTotal === 200 && !r.json[1].moneyHidden, r.json && r.json[1]);
t("money: cancelled hidden", r.json[2].amount === null, r.json && r.json[2]);
r = await call("GET", `hotels/${HID}/bookings`, owner, null, "1111");
t("money: desk staff cannot unlock", r.status === 403 && r.json.needPin, r);
r = await call("GET", `hotels/${HID}/bookings`, owner, null, "5555");
t("money: manager sees all", r.status === 200 && r.json[0].amount === 2500 && r.json[2].amount === 900, r.json && r.json[0]);
r = await call("GET", `hotels/${HID}/bookings`, admin);
t("money: admin sees all", r.status === 200 && r.json[0].amount === 2500, r);
r = await call("GET", `hotels/${HID}/bookings/export`, owner, null, "1111");
t("export: needs reports perm", r.status === 403, r);
pinReset(HID);

srv.close();
console.log(`team: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
