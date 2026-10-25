// บอทจองห้องของแขกใน LINE OA ของโรงแรม (lib/guestbot.js, routes/line.js webhook/:slug, lib/booking.js)
// แทนโมเดลด้วยที่เก็บในหน่วยความจำ + แทน fetch: จับข้อความที่ตอบ/ส่งหา LINE โดยไม่ออกอินเทอร์เน็ตจริง
import crypto from "crypto";
Object.assign(process.env, { LINE_CHANNEL_TOKEN: "central-token", PUBLIC_URL: "https://bp.test", JWT_SECRET: "test-secret-0123456789-abcdef" });
delete process.env.BREVO_API_KEY;

const realFetch = globalThis.fetch;
const PROFILES = {}; // โปรไฟล์ LINE ของแขก (ชื่อ + ภาษา) ที่ OA ของโรงแรมจะได้
const calls = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  if (url.startsWith("http://127.0.0.1")) return realFetch(url, opt);
  calls.push({ url, token: (opt.headers || {}).authorization, sig: (opt.headers || {})["x-line-signature"], raw: opt.body ? String(opt.body) : "", body: opt.body ? JSON.parse(String(opt.body)) : null });
  if (url.includes("/v2/bot/profile/")) return new Response(JSON.stringify(PROFILES[url.split("/").pop()] || {}), { status: 200 });
  if (url.startsWith("https://api.line.me/v2/bot/")) return fakeLineApi(url, opt);
  return new Response("{}", { status: 200 });
};

// LINE API ปลอม สำหรับปุ่ม "ทดสอบการเชื่อม" — จำ Webhook URL + ยิง webhook ทดสอบที่ลงลายเซ็นด้วย secret ของ channel จริง
const LINE = { tokenOk: true, endpoint: "", active: true, secret: "hotel-secret", localBase: "" };
async function fakeLineApi(url, opt) {
  const path = url.replace("https://api.line.me", ""), json = (o, st = 200) => new Response(JSON.stringify(o), { status: st });
  if (!LINE.tokenOk) return json({ message: "Authentication failed" }, 401);
  if (path === "/v2/bot/info") return json({ displayName: "บ้านทดสอบ OA", basicId: "@test" });
  if (path === "/v2/bot/channel/webhook/endpoint" && opt.method === "PUT") { LINE.endpoint = JSON.parse(opt.body).endpoint; return json({}); }
  if (path === "/v2/bot/channel/webhook/endpoint") return json({ endpoint: LINE.endpoint, active: LINE.active });
  if (path === "/v2/bot/channel/webhook/test") {
    const raw = JSON.stringify({ destination: "x", events: [] });
    const sig = crypto.createHmac("sha256", LINE.secret).update(raw).digest("base64");
    const r = await realFetch(JSON.parse(opt.body).endpoint.replace("https://bp.test", LINE.localBase), { method: "POST", headers: { "content-type": "application/json", "x-line-signature": sig }, body: raw });
    return json({ success: r.status === 200, statusCode: r.status, reason: r.status === 200 ? "OK" : "ERROR" });
  }
  return json({});
}

const mongoose = (await import("mongoose")).default;
const Hotel = (await import("../models/Hotel.js")).default;
const RoomType = (await import("../models/RoomType.js")).default;
const Booking = (await import("../models/Booking.js")).default;
const GuestChat = (await import("../models/GuestChat.js")).default;
const LineChat = (await import("../models/LineChat.js")).default;
const Service = (await import("../models/Service.js")).default;
const ActivityBooking = (await import("../models/ActivityBooking.js")).default;
const { handleGuestEvent } = await import("../lib/guestbot.js");
const { notifyGuestPaid } = await import("../lib/notify.js");
const { todayTH } = await import("../lib/linebot.js");
const express = (await import("express")).default;
// รหัสพนักงาน (lib/team.js): ที่พักยังไม่ตั้งทีม → ทำรายการได้โดยไม่ต้องใส่รหัส · ไม่บันทึกประวัติจริง
const TeamStaff = (await import("../models/Staff.js")).default; TeamStaff.countDocuments = async () => 0;
const TeamLog = (await import("../models/ActionLog.js")).default; TeamLog.create = async () => ({});
const lineRoutes = (await import("../routes/line.js")).default;
const publicRoutes = (await import("../routes/public.js")).default;

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };

// ---- ที่เก็บในหน่วยความจำ (รองรับเฉพาะ query ที่โค้ดนี้ใช้)
const S = (v) => (v instanceof mongoose.Types.ObjectId ? String(v) : v);
const eq = (a, b) => (Array.isArray(a) ? a.map(S).includes(S(b)) : String(S(a) ?? "") === String(S(b) ?? "") && (a != null) === (b != null));
function match(d, q = {}) {
  return Object.entries(q).every(([k, c]) => {
    const v = d[k];
    if (c instanceof RegExp) return c.test(String(v ?? ""));
    if (c && typeof c === "object" && !(c instanceof mongoose.Types.ObjectId) && Object.keys(c).some((x) => x[0] === "$")) {
      return Object.entries(c).every(([op, x]) =>
        op === "$ne" ? !eq(v, x) : op === "$lt" ? v < x : op === "$lte" ? v <= x : op === "$gt" ? v > x : op === "$gte" ? v >= x
          : op === "$in" ? x.some((y) => eq(v, y)) : op === "$nin" ? !x.some((y) => eq(v, y)) : op === "$exists" ? (v !== undefined) === x : false);
    }
    return eq(v, c);
  });
}
const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
function chain(run) {
  const c = { s: null, n: 0, sort(x) { this.s = x; return this; }, limit(n) { this.n = n; return this; }, select() { return this; }, lean() { return this; },
    then(a, b) { return Promise.resolve().then(() => run(this)).then(a, b); } };
  return c;
}
const byKeys = (s) => { const ks = typeof s === "string" ? s.split(" ").map((k) => (k[0] === "-" ? [k.slice(1), -1] : [k, 1])) : Object.entries(s || {}); return (a, b) => { for (const [k, d] of ks) { if (a[k] < b[k]) return -d; if (a[k] > b[k]) return d; } return 0; }; };
const db = {};
function stub(M) {
  const rows = (db[M.modelName] = []);
  const find = (q) => rows.filter((r) => match(r, q));
  const setter = (r, u) => { for (const [k, v] of Object.entries(u.$set || {})) r[k] = S(v); for (const [k, v] of Object.entries(u.$inc || {})) r[k] = (r[k] || 0) + v; };
  M.find = (q) => chain((c) => { let r = find(q); if (c.s) r = r.slice().sort(byKeys(c.s)); if (c.n) r = r.slice(0, c.n); return r.map(clone); });
  M.findOne = (q) => chain((c) => { let r = find(q); if (c.s) r = r.slice().sort(byKeys(c.s)); return clone(r[0] || null); });
  M.findById = (id) => M.findOne({ _id: String(id) });
  M.exists = (q) => chain(() => (find(q)[0] ? { _id: find(q)[0]._id } : null));
  M.countDocuments = (q) => chain(() => find(q).length);
  M.create = async (o) => {
    if (M.modelName === "GuestChat" && find({ hotel: o.hotel, userId: o.userId }).length) throw Object.assign(new Error("dup"), { code: 11000 });
    const base = new M({}).toObject(); delete base._id;
    const r = { ...clone(base), ...clone(o), _id: String(new mongoose.Types.ObjectId()), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    rows.push(r); return clone(r);
  };
  M.updateOne = (q, u) => chain(() => { const r = find(q)[0]; if (r) setter(r, u); return { modifiedCount: r ? 1 : 0 }; });
  M.updateMany = (q, u) => chain(() => { const r = find(q); r.forEach((x) => setter(x, u)); return { modifiedCount: r.length }; });
  M.findOneAndUpdate = (q, u) => chain(() => { const r = find(q)[0]; if (!r) return null; const old = clone(r); setter(r, u); return old; });
  M.deleteMany = (q) => chain(() => { const r = find(q); r.forEach((x) => rows.splice(rows.indexOf(x), 1)); return { deletedCount: r.length }; });
}
[Hotel, RoomType, Booking, GuestChat, LineChat, Service, ActivityBooking].forEach(stub);

// ---- ข้อมูลตั้งต้น
const today = todayTH();
const day = (n) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const h = await Hotel.create({
  name: "บ้านทดสอบ", slug: "test-home", phone: "0811111111", promptpayId: "0812345678", payPromptpay: true,
  bankName: "กสิกรไทย", bankAccountNo: "1234567890", bankAccountName: "บ้านทดสอบ", holdHours: 24,
  lineChannelToken: "hotel-token", lineChannelSecret: "hotel-secret",
});
const riverside = await RoomType.create({ hotel: h._id, name: "ริมน้ำ", qty: 2, capacity: 3, basePrice: 1200, breakfast: "optional", breakfastPrice: 150, sort: 1 });
const garden = await RoomType.create({ hotel: h._id, name: "สวน", qty: 1, capacity: 2, basePrice: 900, sort: 2 });
await RoomType.create({ hotel: h._id, name: "วิลล่า", qty: 1, capacity: 4, basePrice: 3000, sort: 3, seasons: [{ name: "ไฮ", from: "2000-01-01", to: "2100-01-01", price: 3500, minNights: 3 }] });
await RoomType.create({ hotel: h._id, name: "ห้องซ่อน", qty: 1, basePrice: 500, sort: 4, hidden: true });
await Booking.create({ hotel: h._id, roomType: garden._id, checkin: day(10), checkout: day(12), status: "confirmed" });

const GUEST = "U" + "1".repeat(32);
let seq = 0, who = GUEST;
async function send(ev) {
  const before = calls.length;
  await handleGuestEvent(await Hotel.findOne({ _id: h._id }).lean(), { replyToken: "rt" + ++seq, source: { type: "user", userId: who }, ...ev });
  const r = calls.slice(before).find((c) => c.url.endsWith("/v2/bot/message/reply"));
  return r ? r.body.messages : [];
}
const say = (s) => send({ type: "message", message: { type: "text", text: s } });
const tap = (data, params) => send({ type: "postback", postback: { data, params } });
const quick = (m) => (m.quickReply?.items || []).map((i) => i.action.data || i.action.type);
const allText = (msgs) => JSON.stringify(msgs);

// ---- เมนู / เริ่มจอง
let m = await send({ type: "follow" });
t("follow → welcome card", m[0]?.type === "flex" && allText(m).includes("เช็คห้องว่าง") && allText(m).includes("บ้านทดสอบ"), m);
t("replies with the hotel's own token", calls.at(-1).token === "Bearer hotel-token", calls.at(-1).token);
m = await say("ห้องว่าง");
t("ห้องว่าง → ask check-in date", allText(m).includes("เข้าพักวันไหน") && quick(m[0]).some((d) => d.startsWith("g=din&d=")), m);
m = await tap("g=din&d=" + day(10));
t("pick date → ask nights", allText(m).includes("พักกี่คืน"), m);
m = await tap("g=n&n=2");
const car = m.find((x) => x.type === "flex");
const names = (car?.contents?.contents || []).map((b) => b.body.contents[0].text);
t("carousel shows free, visible rooms only", JSON.stringify(names) === JSON.stringify(["ริมน้ำ", "วิลล่า"]), names);
t("min-nights room offers longer stay instead of booking", allText(car.contents.contents[1]).includes("g=n&n=3") && !allText(car.contents.contents[1]).includes("g=room"), car.contents.contents[1]);
t("room total = price × nights", allText(car.contents.contents[0]).includes("฿2,400"));

// ---- ขั้นตอนจอง
m = await tap("g=room&id=" + riverside._id);
t("pick room → ask guests (1..capacity)", quick(m[0]).filter((d) => d.startsWith("g=pax")).length === 3, quick(m[0]));
m = await tap("g=pax&n=2");
t("optional breakfast asked", allText(m).includes("อาหารเช้า") && allText(m).includes("฿150"), m);
m = await tap("g=bf&v=1");
t("ask name", allText(m).includes("ชื่อ"), m);
m = await say("สมชาย ใจดี");
t("ask phone", allText(m).includes("เบอร์โทร"), m);
m = await say("12345");
t("bad phone rejected", allText(m).includes("ไม่ถูกต้อง"), m);
m = await say("081-234-5678");
t("ask payment method (promptpay + transfer)", JSON.stringify(quick(m[0])).includes("g=pay&v=promptpay") && JSON.stringify(quick(m[0])).includes("g=pay&v=transfer"), quick(m[0]));
m = await tap("g=pay&v=promptpay");
t("confirm card shows total incl. breakfast (2400 + 150×2×2)", allText(m).includes("฿3,000") && allText(m).includes("g=ok"), m);

// ---- ยืนยัน → สร้างการจองจริง
const pushesBefore = calls.filter((c) => c.url.endsWith("/push")).length;
m = await tap("g=ok");
const bk = db.Booking.find((b) => b.lineUserId === GUEST);
t("booking created via shared createRoomBooking", bk && bk.channel === "direct" && bk.payStatus === "unpaid" && bk.payMethod === "promptpay" && bk.amount === 3000 && bk.guestTel === "0812345678" && bk.breakfast === "added", bk);
t("reply has booking card + PromptPay QR image", m.some((x) => x.type === "image" && x.originalContentUrl.startsWith("https://bp.test/api/public/promptpay-qr?slug=test-home&amount=3000")) && allText(m).includes(bk.ref), m);
t("pay deadline shown", allText(m).includes("กรุณาชำระภายใน"), m);
await new Promise((r) => setTimeout(r, 20));
t("no duplicate push to the guest (bot already replied)", !calls.slice(0).filter((c) => c.url.endsWith("/push")).slice(pushesBefore).some((c) => c.body.to === GUEST), calls.filter((c) => c.url.endsWith("/push")).map((c) => c.body.to));
m = await tap("g=ok");
t("double-tap confirm does not book twice", db.Booking.filter((b) => b.lineUserId === GUEST).length === 1 && allText(m).includes("หมดเวลา"), m);

// ---- สลิป
m = await send({ type: "message", message: { type: "image", id: "img1" } });
const bk2 = db.Booking.find((b) => b._id === bk._id);
t("slip image → reported", bk2.payStatus === "reported" && /สลิป/.test(bk2.payRef), bk2);
t("slip acknowledged", allText(m).includes("ได้รับสลิป"), m);
m = await send({ type: "message", message: { type: "image", id: "img2" } });
t("random photo with nothing to pay → bot stays quiet", m.length === 0, m);
m = await say("การจองของฉัน");
t("my bookings lists the ref", allText(m).includes(bk.ref) && allText(m).includes("แจ้งโอนแล้ว"), m);

// ---- ที่พักยืนยันรับเงิน → แจ้งแขกทาง OA ของโรงแรม
db.Booking.find((b) => b._id === bk._id).payStatus = "paid";
const before = calls.length;
await notifyGuestPaid(bk._id);
const pg = calls.slice(before).find((c) => c.url.endsWith("/push"));
t("guest told payment confirmed via hotel OA", pg && pg.body.to === GUEST && pg.token === "Bearer hotel-token" && pg.body.messages[0].text.includes(bk.ref.replace(/-\d+$/, "")), pg);

// ---- คำสั่งใช้ได้แม้ค้างกลางขั้นตอน + ข้อความทั่วไปไม่ถูกตีเป็นข้อมูลผิดที่
await say("ห้องว่าง"); await tap("g=din&d=" + day(5)); await tap("g=n&n=1"); await tap("g=room&id=" + garden._id); await tap("g=pax&n=1");
m = await say("ห้องว่าง พรุ่งนี้");
t("ห้องว่าง mid-flow restarts instead of becoming the guest name", allText(m).includes("พักกี่คืน"), m);
await tap("g=x");
m = await say("ขอบคุณค่ะ");
t("general chat → menu once", allText(m).includes("เช็คห้องว่าง"), m);
m = await say("ที่จอดรถมีไหม");
t("then quiet so staff can answer", m.length === 0, m);

// ---- เตียงเสริม + บริการเสริม/กิจกรรมซื้อพ่วง
const loft = await RoomType.create({ hotel: h._id, name: "ห้องใต้หลังคา", qty: 1, capacity: 2, basePrice: 1000, extraBedPrice: 300, sort: 5 });
const massage = await Service.create({ hotel: h._id, name: "นวดไทย", price: 500, unit: "ต่อท่าน", saleMode: "addon", sort: 1 });
await Service.create({ hotel: h._id, name: "ทัวร์เดี่ยว", price: 800, saleMode: "standalone", sort: 2 });
await Service.create({ hotel: h._id, name: "ปิดขาย", price: 200, saleMode: "both", hidden: true, sort: 3 });
await Service.create({ hotel: h._id, name: "ฟรี", price: 0, saleMode: "addon", sort: 4 });
const kayak = await Service.create({ hotel: h._id, name: "พายเรือ", price: 250, unit: "ต่อครั้ง", saleMode: "both", sort: 5 });
await say("ห้องว่าง"); await tap("g=din&d=" + day(30));
m = await tap("g=n&n=2");
const loftCard = (m.find((x) => x.type === "flex")?.contents?.contents || []).find((b) => b.body.contents[0].text === "ห้องใต้หลังคา");
t("room card mentions extra bed price", loftCard && allText(loftCard).includes("เตียงเสริม") && allText(loftCard).includes("฿300"), loftCard);
m = await tap("g=room&id=" + loft._id);
t("guests offered up to capacity + 2 extra beds", quick(m[0]).filter((d) => d.startsWith("g=pax")).length === 4, quick(m[0]));
m = await tap("g=pax&n=3");
t("3 guests in a 2-person room → must add ≥1 bed", JSON.stringify(quick(m[0])).includes("g=eb&n=1") && !JSON.stringify(quick(m[0])).includes("g=eb&n=0") && allText(m).includes("อย่างน้อย 1"), quick(m[0]));
m = await tap("g=eb&n=0");
t("too few extra beds rejected", allText(m).includes("เตียงเสริม 1–2"), m);
m = await tap("g=eb&n=1");
const adCards = (m.find((x) => x.type === "flex")?.contents?.contents || []).map((b) => b.body.contents[0].text);
t("add-on cards: only sellable, priced, visible services", JSON.stringify(adCards) === JSON.stringify(["นวดไทย", "พายเรือ"]), adCards);
m = await tap("g=ad&id=" + massage._id);
t("add-on → ask which day of the stay (+ every day)", JSON.stringify(quick(m[0])).includes("g=adday&d=" + day(30)) && JSON.stringify(quick(m[0])).includes("g=adday&d=" + day(32)) && JSON.stringify(quick(m[0])).includes("g=adday&d=all"), quick(m[0]));
m = await tap("g=adday&d=" + day(40));
t("day outside the stay refused", allText(m).includes("ช่วงที่พัก"), m);
m = await tap("g=adday&d=" + day(31));
t("ask add-on quantity (per person)", allText(m).includes("กี่ท่าน") && quick(m[0]).includes("g=adq&n=3"), m);
m = await tap("g=adq&n=2");
t("add-on summary shows day, pick and subtotal", allText(m).includes("นวดไทย × 2") && allText(m).includes("฿1,000"), m);
await tap("g=ad&id=" + massage._id); await tap("g=adday&d=" + day(30));
m = await tap("g=adq&n=1");
t("same extra on another day is a separate line", (allText(m).match(/นวดไทย ×/g) || []).length === 2 && allText(m).includes("฿1,500"), m);
await tap("g=ad&id=" + kayak._id); await tap("g=adday&d=all");
m = await tap("g=adq&n=1");
t("'every day' adds one line per day of the stay", (allText(m).match(/พายเรือ ×/g) || []).length === 3, m);
await tap("g=ad&id=" + kayak._id); await tap("g=adday&d=all");
m = await tap("g=adq&n=0");
t("add-on can be removed again (all days)", !allText(m).includes("พายเรือ ×"), m);
m = await tap("g=adok");
t("then asks name", allText(m).includes("ชื่อ"), m);
await say("ครอบครัวสาม"); await say("0855555555");
m = await tap("g=pay&v=transfer");
t("confirm: room + extra bed + add-ons = (1000×2) + (300×2) + 500×3", allText(m).includes("฿4,100") && allText(m).includes("เตียงเสริม 1 × 2 คืน") && allText(m).includes("นวดไทย × 2"), m);
m = await tap("g=ok");
const fam = db.Booking.find((b) => b.guestName === "ครอบครัวสาม");
t("booking saved with extra bed + dated add-ons, amount matches", fam && fam.extraBed === 1 && fam.addonTotal === 1500 && fam.amount === 4100 && fam.addons.length === 2 && fam.addons[0].date === day(30) && fam.addons[1].date === day(31) && fam.addons[1].qty === 2, fam);
t("bank transfer details sent", allText(m).includes("123-4-56789-0") || allText(m).includes("1234567890"), m);
db.Booking.splice(db.Booking.indexOf(db.Booking.find((b) => b._id === fam._id)), 1); // ไม่นับรวมการทดสอบจองค้างจ่ายด้านล่าง

// ---- อาหารเช้าเลือกรายเช้า (เช้าหลังแต่ละคืน) + สรุปงานครัวรายวัน
const { serviceForDay } = await import("../lib/notify.js");
await say("ห้องว่าง"); await tap("g=din&d=" + day(50)); await tap("g=n&n=3"); await tap("g=room&id=" + riverside._id); m = await tap("g=pax&n=2");
t("3 nights → choose breakfast per morning (3 mornings, not check-in day)", JSON.stringify(quick(m[0])).includes("g=bft&d=" + day(51)) && JSON.stringify(quick(m[0])).includes("g=bft&d=" + day(53)) && !JSON.stringify(quick(m[0])).includes("g=bft&d=" + day(50)), quick(m[0]));
await tap("g=bft&d=" + day(51)); await tap("g=bft&d=" + day(52));
m = await tap("g=bft&d=" + day(53));
t("toggled mornings shown with subtotal (3 × 2 × 150)", allText(m).includes("฿900") && (allText(m).match(/✅/g) || []).length >= 3, m);
m = await tap("g=bft&d=" + day(52));
t("tap again removes that morning (2 × 2 × 150)", allText(m).includes("฿600"), m);
m = await tap("g=bfok");
t("then extras step", allText(m).includes("บริการเสริม"), m);
await tap("g=adok"); await say("ทานบางวัน"); await say("0866666666");
m = await tap("g=pay&v=transfer");
t("confirm: 1200×3 + breakfast 2 mornings × 2 = 4,200, lists the mornings", allText(m).includes("฿4,200") && allText(m).includes("2 เช้า"), m);
await tap("g=ok");
const part = db.Booking.find((b) => b.guestName === "ทานบางวัน");
t("saved breakfastDates + total", part && JSON.stringify(part.breakfastDates) === JSON.stringify([day(51), day(53)]) && part.breakfastTotal === 600 && part.amount === 4200, part);
let sv = await serviceForDay(h._id, day(51));
t("kitchen summary: breakfast on a chosen morning", sv.bfPax === 2 && sv.bfWho.some((x) => x.includes("ทานบางวัน")), sv);
sv = await serviceForDay(h._id, day(52));
t("kitchen summary: no breakfast on a skipped morning", !sv.bfWho.some((x) => x.includes("ทานบางวัน")), sv);
sv = await serviceForDay(h._id, day(50));
t("no breakfast on check-in day", !sv.bfWho.some((x) => x.includes("ทานบางวัน")), sv);
db.Booking.splice(db.Booking.indexOf(part), 1);

// ---- จองค้างจ่ายได้ไม่เกิน 3 รายการ
for (let i = 0; i < 3; i++) await Booking.create({ hotel: h._id, roomType: riverside._id, checkin: day(40 + i), checkout: day(41 + i), status: "confirmed", payStatus: "unpaid", lineUserId: GUEST, ref: "BP-OPEN0" + i });
await say("ห้องว่าง"); await tap("g=din&d=" + day(20)); await tap("g=n&n=1"); await tap("g=room&id=" + garden._id); await tap("g=pax&n=1");
m = await say("ไม่เอาค่ะ");
t("typing 'ไม่…' at add-ons skips to name", allText(m).includes("ชื่อ"), m);
await say("สมชาย"); await say("0812345678"); await tap("g=pay&v=transfer");
const n0 = db.Booking.length;
m = await tap("g=ok");
t("4th unpaid booking refused", db.Booking.length === n0 && allText(m).includes("ยังไม่ชำระ"), m);

// ================================================================ ภาษาอังกฤษ · กิจกรรมเดี่ยว · จัดการการจอง (แขกคนใหม่)
const { notifyCancel, preArrivalLine } = await import("../lib/notify.js");
const EN = "U" + "2".repeat(32);
PROFILES[EN] = { displayName: "Anna Smith", language: "en" };
who = EN;
m = await send({ type: "follow" });
t("EN: language taken from LINE profile", allText(m).includes("Welcome") && allText(m).includes("Rooms & booking") && allText(m).includes("Book an activity"), m);
t("EN: guest name remembered from profile", db.GuestChat.find((c) => c.userId === EN)?.name === "Anna Smith");
m = await say("ไทย");
t("switch to Thai by typing ไทย", allText(m).includes("เช็คห้องว่าง") && !allText(m).includes("Rooms & booking"), m);
m = await tap("g=lang&v=en");
t("switch back to English by button", allText(m).includes("Rooms & booking"), m);
m = await say("rooms");
t("EN: rooms keyword → ask date in English", allText(m).includes("When would you like to check in"), m);
await tap("g=x");

// ---- กิจกรรมเดี่ยว: รอบเวลา + ที่ว่างต่อรอบ
const cooking = await Service.create({ hotel: h._id, name: "คลาสทำอาหาร", price: 600, saleMode: "both", times: ["09:00", "14:00"], dailyCap: 4, sort: 6 });
await ActivityBooking.create({ hotel: h._id, service: cooking._id, serviceName: "คลาสทำอาหาร", date: day(15), time: "14:00", qty: 4, status: "confirmed" });
m = await say("activities");
const actNames = (m.find((x) => x.type === "flex")?.contents?.contents || []).map((b) => b.body.contents[0].text);
t("activity list: standalone/both only, not hidden", JSON.stringify(actNames) === JSON.stringify(["ทัวร์เดี่ยว", "พายเรือ", "คลาสทำอาหาร"]), actNames);
m = await tap("g=act&id=" + cooking._id);
t("activity → ask day", allText(m).includes("Which day") && quick(m[0]).some((d) => d.startsWith("g=adt&d=")), m);
m = await tap("g=adt&d=" + day(15));
const slots = (m[0].quickReply?.items || []).map((i) => i.action.label);
t("full time slot hidden, open slot shows spots left", slots.includes("09:00 (4 left)") && !slots.some((l) => l.startsWith("14:00")), slots);
m = await tap("g=atm&t=14:00");
t("tapping a full slot is refused", allText(m).includes("just filled up") || allText(m).includes("expired"), m);
m = await tap("g=atm&t=09:00");
t("qty limited to spots left", quick(m[0]).filter((d) => d.startsWith("g=aq")).length === 4, quick(m[0]));
m = await tap("g=aq&n=5");
t("more than spots left refused", allText(m).includes("1–4"), m);
m = await tap("g=aq&n=2");
t("ask name with LINE-name shortcut", allText(m).includes("full name") && quick(m[0]).includes("g=nm"), m);
await tap("g=nm"); await say("+66 81 234 5678");
m = await tap("g=pay&v=promptpay");
t("activity confirm: 600 × 2 = 1,200", allText(m).includes("฿1,200") && allText(m).includes("09:00"), m);
m = await tap("g=ok");
const ab = db.ActivityBooking.find((a) => a.lineUserId === EN);
t("activity booking saved via createActivityBooking", ab && ab.amount === 1200 && ab.qty === 2 && ab.time === "09:00" && ab.payStatus === "unpaid" && ab.payMethod === "promptpay" && ab.guestName === "Anna Smith" && ab.guestTel === "0812345678", ab);
t("activity: QR for 1,200 + slip instructions in English", m.some((x) => x.type === "image" && x.originalContentUrl.includes("amount=1200")) && allText(m).includes("send a photo of your slip"), m);
m = await send({ type: "message", message: { type: "image", id: "img9" } });
t("slip for activity → reported", db.ActivityBooking.find((a) => a._id === ab._id).payStatus === "reported" && allText(m).includes("Got your slip"), m);

// ---- การจองของฉัน + ยกเลิก
const farRoom = await Booking.create({ hotel: h._id, roomType: garden._id, checkin: day(25), checkout: day(26), status: "confirmed", payStatus: "unpaid", payMethod: "transfer", amount: 900, lineUserId: EN, ref: "BP-FAR001", createdAt: new Date().toISOString() });
const soonRoom = await Booking.create({ hotel: h._id, roomType: garden._id, checkin: day(1), checkout: day(2), status: "confirmed", payStatus: "paid", amount: 900, lineUserId: EN, ref: "BP-SOON01" });
m = await say("my bookings");
const myCards = m.find((x) => x.type === "flex")?.contents?.contents || [];
t("my bookings: room + activity cards, sorted by date", myCards.length === 3 && allText(myCards[0]).includes("BP-SOON01") && allText(myCards).includes(ab.ref) && allText(myCards).includes("BP-FAR001"), myCards.map((c) => c.header?.contents?.[0]?.text));
t("unpaid card has pay button + cancel button", allText(myCards.find((c) => allText(c).includes("BP-FAR001"))).includes("g=pay2&ref=BP-FAR001") && allText(myCards).includes("g=cx&ref=BP-FAR001"));
m = await tap("g=pay2&ref=BP-FAR001");
t("pay again → bank details for 900", allText(m).includes("Bank transfer") && allText(m).includes("฿900"), m);
m = await tap("g=cx&ref=BP-FAR001");
t("cancel early → free cancellation shown", allText(m).includes("Free cancellation") && allText(m).includes("g=cxok&ref=BP-FAR001"), m);
m = await tap("g=cx&ref=BP-SOON01");
t("cancel late (tomorrow) → warns terms + paid refund note", allText(m).includes("Past the free-cancellation") && allText(m).includes("refund"), m);
m = await tap("g=cxok&ref=BP-FAR001");
const far2 = db.Booking.find((b) => b._id === farRoom._id);
t("cancel done: status cancelled, reason guest", far2.status === "cancelled" && far2.cancelReason === "guest" && allText(m).includes("has been cancelled"), far2);
m = await tap("g=cxok&ref=BP-FAR001");
t("cancel twice → not found / already", allText(m).includes("not found") || allText(m).includes("already"), m);
const other = "U" + "3".repeat(32);
await Booking.create({ hotel: h._id, roomType: garden._id, checkin: day(28), checkout: day(29), status: "confirmed", lineUserId: other, ref: "BP-OTHER1" });
m = await tap("g=cxok&ref=BP-OTHER1");
t("can't cancel someone else's booking", db.Booking.find((b) => b.ref === "BP-OTHER1").status === "confirmed", m);
db.Hotel[0].allowGuestCancel = false;
m = await tap("g=cx&ref=BP-SOON01");
t("hotel disallows online cancel → refused", allText(m).includes("doesn't allow online cancellation") && db.Booking.find((b) => b.ref === "BP-SOON01").status === "confirmed", m);
db.Hotel[0].allowGuestCancel = true;

// ---- แจ้งแขกทาง OA ของโรงแรม (ภาษาของแขก)
let k0 = calls.length;
await notifyGuestPaid(ab._id, "act");
let pushed = calls.slice(k0).find((c) => c.url.endsWith("/push"));
t("activity paid → English push from hotel OA", pushed && pushed.body.to === EN && pushed.token === "Bearer hotel-token" && pushed.body.messages[0].text.includes("received your payment") && pushed.body.messages[0].text.includes(ab.ref), pushed);
db.Hotel[0].checkInTime = "14:00"; db.Hotel[0].mapUrl = "https://maps.google.com/?q=1,2";
k0 = calls.length;
let n1 = await preArrivalLine(day(1));
pushed = calls.slice(k0).filter((c) => c.url.endsWith("/push") && c.body.to === EN);
t("day-before reminder: check-in time + map + ref", n1 >= 1 && pushed.some((c) => c.body.messages[0].text.includes("BP-SOON01") && c.body.messages[0].text.includes("14:00")), pushed.map((c) => c.body.messages[0].text));
const n2 = await preArrivalLine(day(1));
t("reminder not sent twice", n2 === 0, n2);
k0 = calls.length;
await notifyCancel(h._id, [db.Booking.find((b) => b.ref === "BP-SOON01")], { by: "auto" });
pushed = calls.slice(k0).find((c) => c.url.endsWith("/push") && c.body.to === EN);
t("auto-cancel → guest told in LINE", pushed && pushed.body.messages[0].text.includes("cancelled automatically"), pushed);
delete db.Hotel[0].checkInTime; delete db.Hotel[0].mapUrl;
who = GUEST;

// ---- webhook ของโรงแรม: ตรวจลายเซ็น + โหมดตั้งค่า + หน้าเว็บยังจองได้เหมือนเดิม
const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use("/api/line", lineRoutes); app.use("/api/public", publicRoutes);
const hotelRoutes = (await import("../routes/hotels.js")).default;
const { sign } = await import("../lib/auth.js");
app.use("/api", hotelRoutes);
const srv = app.listen(0); await new Promise((r) => srv.once("listening", r));
const base = "http://127.0.0.1:" + srv.address().port;
const hook = async (slug, payload, secret) => {
  const raw = JSON.stringify(payload);
  const sig = secret ? crypto.createHmac("sha256", secret).update(raw).digest("base64") : "bad";
  return realFetch(base + "/api/line/webhook/" + slug, { method: "POST", headers: { "content-type": "application/json", "x-line-signature": sig }, body: raw });
};
const evt = { events: [{ type: "message", replyToken: "rw", webhookEventId: "w1", source: { type: "user", userId: "U" + "9".repeat(32) }, message: { type: "text", text: "ห้องว่าง" } }] };
let res = await hook("test-home", evt, null);
t("bad signature → 401", res.status === 401, res.status);
const c0 = calls.length;
res = await hook("test-home", evt, "hotel-secret");
await new Promise((r) => setTimeout(r, 30));
t("good signature → guest bot replies", res.status === 200 && calls.slice(c0).some((c) => c.url.endsWith("/reply") && JSON.stringify(c.body).includes("เข้าพักวันไหน")), calls.slice(c0));
db.Hotel[0].lineChannelSecret = "";
const c1 = calls.length;
res = await hook("test-home", { events: [{ ...evt.events[0], webhookEventId: "w2" }] }, null);
t("no secret → setup mode (reply userId, no booking bot)", res.status === 200 && calls.slice(c1).some((c) => JSON.stringify(c.body).includes("userId ของคุณคือ")), calls.slice(c1));
res = await realFetch(base + "/api/public/book", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ slug: "test-home", roomTypeId: riverside._id, din: day(60), dout: day(62), name: "เว็บ", tel: "0899999999", pax: 2, payMethod: "promptpay" }) });
const wb = await res.json();
t("website booking still works", res.status === 200 && wb.ok && wb.amount === 2400 && /^BP-/.test(wb.ref), wb);
res = await realFetch(base + "/api/public/book", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ slug: "test-home", roomTypeId: riverside._id, din: day(70), dout: day(71), name: "เว็บ", tel: "0899999999", pax: 1, payMethod: "promptpay",
    addons: [{ name: "ทัวร์เดี่ยว", qty: 1 }, { name: "ปิดขาย", qty: 1 }, { serviceId: String(massage._id), qty: 1 }] }) });
const wb2 = await res.json();
t("website: standalone-only / hidden services can't be added to a room", res.status === 200 && wb2.addonTotal === 500, wb2);
res = await realFetch(base + "/api/public/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "nope" }) });
t("website: unknown hotel → 404", res.status === 404, res.status);

// ---- ปุ่ม "ทดสอบและตั้งค่าอัตโนมัติ" ในเว็บหลังบ้าน (POST /api/hotels/:id/line/check)
LINE.localBase = base;
db.Hotel[0].lineChannelSecret = "hotel-secret";
const owner = sign({ _id: "u-owner", role: "owner", hotel: h._id }), stranger = sign({ _id: "u-x", role: "owner", hotel: "64b7f0c2a1b2c3d4e5f60718" });
const check = async (tok, body = {}) => { const r2 = await realFetch(base + `/api/hotels/${h._id}/line/check`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: JSON.stringify(body) }); return { status: r2.status, j: await r2.json() }; };
const failed = (j) => j.steps.filter((x) => !x.ok).map((x) => x.title);
let ck = await check(stranger);
t("check: other hotel's owner refused", ck.status === 403, ck);
ck = await check(owner);
t("check: webhook not set → reported, nothing changed", !ck.j.ok && failed(ck.j).includes("Webhook URL") && LINE.endpoint === "", ck.j);
ck = await check(owner, { fix: true });
t("check+fix: sets webhook URL and LINE test passes", ck.j.ok && LINE.endpoint === "https://bp.test/api/line/webhook/test-home", ck.j);
LINE.secret = "other-channel-secret";
ck = await check(owner, { fix: true });
t("check: wrong secret → 401 explained", !ck.j.ok && JSON.stringify(ck.j).includes("401") && JSON.stringify(ck.j).includes("Channel secret"), ck.j);
LINE.secret = "hotel-secret"; LINE.active = false;
ck = await check(owner, { fix: true });
t("check: Use webhook off → reported", !ck.j.ok && failed(ck.j).includes("เปิด Use webhook"), ck.j);
LINE.active = true; LINE.tokenOk = false;
ck = await check(owner, { fix: true });
t("check: bad token → stops early with fix hint", !ck.j.ok && failed(ck.j).includes("token ใช้งานได้") && ck.j.steps.length === 2, ck.j);
LINE.tokenOk = true;
db.Hotel[0].lineChannelSecret = "";
ck = await check(owner, { fix: true });
t("check: missing secret → reported", !ck.j.ok && failed(ck.j).includes("Channel secret"), ck.j);

// ---- ใช้ OA เดียวร่วมกับระบบอื่น: Barn Park ตอบเฉพาะเรื่องจอง ที่เหลือส่งต่อ Webhook เดิม
const { cleanForwardUrl } = await import("../lib/lineforward.js");
t("forward URL: https only, no own host / our webhook / IP / localhost", cleanForwardUrl("https://other.example/hook") === "https://other.example/hook" && cleanForwardUrl("") === ""
  && cleanForwardUrl("https://barnbarn-site.onrender.com/api/line/webhook") === "https://barnbarn-site.onrender.com/api/line/webhook"
  && [ "https://barnpark.onrender.com/api/line/webhook/barnbarn", "https://other.example/api/line/webhook/barnbarn", "http://other.example/hook", "https://bp.test/x", "https://x.example/api/line/webhook/a", "https://10.0.0.1/h", "https://localhost/h", "nope" ].every((u) => cleanForwardUrl(u) === null));
db.Hotel[0].lineChannelSecret = "hotel-secret"; db.Hotel[0].lineForwardUrl = "https://other.example/hook";
const OTHER = "U" + "7".repeat(32);
const ev = (o) => ({ replyToken: "r" + Math.random(), webhookEventId: "e" + Math.random(), source: { type: "user", userId: OTHER }, timestamp: 1, mode: "active", ...o });
const tx = (s) => ev({ type: "message", message: { type: "text", id: "m", text: s } });
const send2 = async (events) => { const c = calls.length; const r2 = await hook("test-home", { destination: "Udest", events }, "hotel-secret"); await new Promise((r) => setTimeout(r, 40));
  const after = calls.slice(c); return { status: r2.status, fwd: after.filter((x) => x.url === "https://other.example/hook"), replies: after.filter((x) => x.url.endsWith("/reply")) }; };
const okSig = (f) => crypto.createHmac("sha256", "hotel-secret").update(f.raw).digest("base64") === f.sig;
let sh = await send2([tx("ฝากกิจกรรม")]);
t("shared: 'ฝากกิจกรรม' forwarded to the other system, Barn Park silent", sh.fwd.length === 1 && sh.replies.length === 0 && sh.fwd[0].body.events[0].message.text === "ฝากกิจกรรม" && okSig(sh.fwd[0]), sh);
sh = await send2([tx("เมนู")]);
t("shared: generic 'เมนู' forwarded", sh.fwd.length === 1 && sh.replies.length === 0, sh);
sh = await send2([ev({ type: "follow" })]);
t("shared: add-friend (follow) forwarded", sh.fwd.length === 1 && sh.replies.length === 0, sh);
sh = await send2([tx("ห้องว่าง")]);
t("shared: 'ห้องว่าง' answered by Barn Park, not forwarded", sh.fwd.length === 0 && sh.replies.length === 1 && JSON.stringify(sh.replies[0].body).includes("เข้าพักวันไหน"), sh);
sh = await send2([tx("ฝากกิจกรรม")]);
t("shared: in the middle of booking → Barn Park keeps the conversation", sh.fwd.length === 0 && sh.replies.length === 1, sh);
await send2([ev({ type: "postback", postback: { data: "g=x" } })]);
sh = await send2([tx("ฝากกิจกรรม"), tx("การจองของฉัน")]);
t("shared: mixed batch → only foreign event forwarded, re-signed with channel secret", sh.fwd.length === 1 && sh.fwd[0].body.events.length === 1 && sh.fwd[0].body.events[0].message.text === "ฝากกิจกรรม" && sh.fwd[0].body.destination === "Udest" && okSig(sh.fwd[0]) && sh.replies.length === 1, sh);
sh = await send2([ev({ type: "message", message: { type: "image", id: "i1" } })]);
t("shared: photo with nothing to pay → forwarded", sh.fwd.length === 1 && sh.replies.length === 0, sh);
sh = await send2([ev({ type: "postback", postback: { data: "action=other-system" } })]);
t("shared: other system's own buttons forwarded", sh.fwd.length === 1 && sh.replies.length === 0, sh);
const gr = await send2([{ ...tx("ฝากกิจกรรม"), source: { type: "group", groupId: "C1", userId: OTHER } }]);
t("shared: group messages forwarded", gr.fwd.length === 1 && gr.replies.length === 0, gr);
db.Hotel[0].lineForwardUrl = "";
sh = await send2([tx("ฝากกิจกรรม")]);
t("not shared: nothing forwarded (Barn Park handles the OA alone)", sh.fwd.length === 0, sh);

// ---- ปุ่มตั้งค่าอัตโนมัติไม่เขียนทับ Webhook ของระบบอื่นเงียบ ๆ
db.Hotel[0].lineChannelSecret = "hotel-secret"; LINE.endpoint = "https://other.example/hook"; LINE.active = true;
ck = await check(owner, { fix: true });
t("check: OA connected to another system → asks first, changes nothing", !ck.j.ok && ck.j.conflict === "https://other.example/hook" && LINE.endpoint === "https://other.example/hook" && !db.Hotel[0].lineForwardUrl, ck.j);
ck = await check(owner, { fix: true, takeover: true });
t("check+takeover: keeps old webhook as forward target, points OA to Barn Park, test passes", ck.j.ok && LINE.endpoint === "https://bp.test/api/line/webhook/test-home" && db.Hotel[0].lineForwardUrl === "https://other.example/hook" && JSON.stringify(ck.j).includes("ร่วมกับระบบอื่น"), ck.j);
db.Hotel[0].lineForwardUrl = "";
srv.close();

console.log(`guestbot: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
