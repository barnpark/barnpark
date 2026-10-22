// =====================================================================
//  บอทของแขก — ทำงานใน LINE OA ของแต่ละโรงแรม (webhook /api/line/webhook/<slug>)
//  🛏 จองห้อง: เช็คห้องว่าง → เลือกห้อง → จำนวนท่าน → เตียงเสริม → อาหารเช้า → บริการเสริม → ชื่อ/เบอร์ → วิธีชำระ → ยืนยัน
//  🎟 จองกิจกรรมเดี่ยว (ไม่ต้องพัก): เลือกกิจกรรม → วัน → รอบเวลา → จำนวน → ชื่อ/เบอร์ → วิธีชำระ → ยืนยัน
//  📋 การจองของฉัน: ดูทุกการจอง → ชำระ/ส่งสลิป → ยกเลิกตามนโยบายของที่พัก
//  → QR พร้อมเพย์ / เลขบัญชี → ส่งรูปสลิปในแชท → แจ้งที่พักตรวจ → ที่พักกดยืนยัน → แจ้งแขก (notifyGuestPaid)
//  จองด้วย createRoomBooking / createActivityBooking ตัวเดียวกับหน้าเว็บ (ราคา ขั้นต่ำคืน กันจองซ้อน ปล่อยห้องค้างจ่าย)
//  ภาษา: ไทย / อังกฤษ — เดาจากภาษาที่ตั้งใน LINE ของแขก เปลี่ยนเองได้ (พิมพ์ English / ไทย)
//  ตอบด้วย reply ของ OA โรงแรม (ฟรี) · สลิปอยู่ในแชท OA ของโรงแรมเอง ไม่เก็บลงฐานข้อมูล
// =====================================================================
import mongoose from "mongoose";
import GuestChat from "../models/GuestChat.js";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Service from "../models/Service.js";
import Booking from "../models/Booking.js";
import ActivityBooking from "../models/ActivityBooking.js";
import * as L from "./line.js";
import * as U from "./lineui.js";
import { baseUrl } from "./baseurl.js";
import { rateFor } from "./pricing.js";
import { breakfastOf, stayInfo } from "./stay.js";
import { payMethodsOf, resolvePayChoice } from "./pay.js";
import { formatPromptPayId } from "./promptpay.js";
import { createRoomBooking } from "./booking.js";
import { sellsAddon, sellsStandalone, availability, createActivityBooking } from "./activity.js";
import { notifyPaidReport, notifyActivity, notifyCancel } from "./notify.js";
import { parseDate, normPhone, todayTH } from "./linebot.js";

const { C, q, qDate, qRoll, qCam, text, flex, bubble, carousel, btn, pb, uri, T, kv, sep, money, fit } = U;

const FLOW_TTL = 3 * 3600e3;          // ขั้นตอนที่ค้างเกิน 3 ชม. เริ่มใหม่
const NUDGE_EVERY = 12 * 3600e3;      // ข้อความทั่วไป (ไม่ใช่คำสั่ง) ตอบเมนูไม่เกินทุก 12 ชม. — ให้ทีมที่พักคุยเองได้
const MAX_OPEN = 3;                   // แขก 1 คน จองค้างจ่ายได้พร้อมกันไม่เกิน 3 รายการต่อที่พัก (กันกดจองเล่นจนห้องเต็ม)
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_D = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const EN_M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nightsOf = (a, b) => Math.max(0, Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5));
const nextDow = (ymd, dow) => addDays(ymd, (dow - new Date(ymd + "T00:00:00Z").getUTCDay() + 7) % 7);
const isId = (s) => mongoose.isValidObjectId(String(s || ""));
const https = (u) => (/^https:\/\//.test(String(u || "")) ? u : "");
const B = () => https(baseUrl());
const bookUrl = (h) => (B() ? `${B()}/book.html?h=${encodeURIComponent(h.slug)}` : "");
const roomImg = (rt) => https(rt.images && rt.images[0]) || (B() && ((rt.images && rt.images[0]) || rt.imageUrl) ? `${B()}/api/public/img/room/${rt._id}/0?w=line&v=${new Date(rt.updatedAt || 0).getTime()}` : "") || https(rt.imageUrl);
const svcImg = (s) => https(s.imageUrl) || (B() && s.imageUrl ? `${B()}/api/public/img/svc/${s._id}/0?w=line&v=${new Date(s.updatedAt || 0).getTime()}` : "");
const telUri = (t) => { const d = String(t || "").replace(/[^\d+]/g, ""); return d.length >= 9 ? "tel:" + d : ""; };
const groupOf = (ref) => (/^(BP-[A-Z0-9]{6})/.exec(String(ref || "")) || [])[1] || "";

// ---------------------------------------------------------------- ภาษา
const tr = (ctx, th, en) => (ctx.lang === "en" ? en : th);
const fDate = (ctx, ymd) => { const d = new Date(ymd + "T00:00:00Z"); if (isNaN(d)) return ymd; return ctx.lang === "en" ? `${EN_D[d.getUTCDay()]} ${d.getUTCDate()} ${EN_M[d.getUTCMonth()]}` : `${TH_D[d.getUTCDay()]} ${d.getUTCDate()} ${TH_M[d.getUTCMonth()]}`; };
const fWhen = (ctx, dt) => { const d = new Date(new Date(dt).getTime() + 7 * 3600e3), hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; return ctx.lang === "en" ? `${d.getUTCDate()} ${EN_M[d.getUTCMonth()]} ${hm}` : `${d.getUTCDate()} ${TH_M[d.getUTCMonth()]} ${hm} น.`; };
const nN = (ctx, n) => tr(ctx, `${n} คืน`, `${n} night${n > 1 ? "s" : ""}`);
const nP = (ctx, n) => tr(ctx, `${n} ท่าน`, `${n} guest${n > 1 ? "s" : ""}`);
export const langOf = (lineLang) => (/^th/i.test(String(lineLang || "th")) ? "th" : "en");

const qCancel = (ctx) => q(tr(ctx, "✖ ยกเลิก", "✖ Cancel"), "g=x", tr(ctx, "ยกเลิก", "Cancel"));
const qStart = (ctx) => q(tr(ctx, "🔎 เช็คห้องว่าง", "🔎 Rooms"), "g=start", tr(ctx, "เช็คห้องว่าง", "Check rooms"));
const qMine = (ctx) => q(tr(ctx, "📋 การจองของฉัน", "📋 My bookings"), "g=my", tr(ctx, "การจองของฉัน", "My bookings"));
const qActs = (ctx) => q(tr(ctx, "🎟 กิจกรรม", "🎟 Activities"), "g=acts", tr(ctx, "จองกิจกรรม", "Activities"));
const qLang = (ctx) => (ctx.lang === "en" ? q("🌐 ภาษาไทย", "g=lang&v=th", "ภาษาไทย") : q("🌐 English", "g=lang&v=en", "English"));
const homeQuick = (ctx, hasActs) => [qStart(ctx), hasActs ? qActs(ctx) : null, qMine(ctx), qLang(ctx)];

// ---------------------------------------------------------------- state
async function loadChat(h, uid) {
  let chat = await GuestChat.findOne({ hotel: h._id, userId: uid }).lean();
  if (!chat) {
    // แขกใหม่: ดึงชื่อ + ภาษาจากโปรไฟล์ LINE (ผ่าน OA ของโรงแรม) — ไม่ได้ก็ไม่เป็นไร
    const p = await L.getProfileAs(h.lineChannelToken, uid);
    try { await GuestChat.create({ hotel: h._id, userId: uid, name: (p && p.displayName) || "", lang: langOf(p && p.language) }); } catch (e) { if (e?.code !== 11000) throw e; }
    chat = await GuestChat.findOne({ hotel: h._id, userId: uid }).lean();
  }
  if (!chat.data) chat.data = {};
  return chat;
}
async function setFlow(ctx, step, data) {
  const flowAt = new Date();
  await GuestChat.updateOne({ _id: ctx.chat._id }, { $set: { flow: "bk", step, data, flowAt } });
  Object.assign(ctx.chat, { flow: "bk", step, data, flowAt });
}
async function clearFlow(ctx) {
  if (!ctx.chat.flow) return;
  await GuestChat.updateOne({ _id: ctx.chat._id }, { $set: { flow: "", step: "", data: {} } });
  Object.assign(ctx.chat, { flow: "", step: "", data: {} });
}
const ask = async (ctx, step, data, ...msgs) => { await setFlow(ctx, step, data); ctx.say(...msgs); };
const stale = (ctx) => ctx.say(text(tr(ctx, "ขั้นตอนนี้หมดเวลาแล้ว เริ่มใหม่ได้เลยค่ะ 🙏", "This step has expired — please start again 🙏"), [qStart(ctx), qMine(ctx)]));

// ================================================================ entry
// h = โรงแรม (lean, มี lineChannelToken) · เรียกหลังตรวจลายเซ็น webhook แล้วเท่านั้น
export async function handleGuestEvent(h, ev) {
  const uid = ev?.source?.userId;
  if (!uid || ev.source.type !== "user" || ev.type === "unfollow") return;
  const chat = await loadChat(h, uid);
  const ctx = { h, uid, chat, ev, lang: chat.lang === "en" ? "en" : "th", out: [], say(...m) { for (const x of m.flat()) if (x) this.out.push(x); } };
  if (chat.flow && (!chat.flowAt || Date.now() - new Date(chat.flowAt).getTime() > FLOW_TTL)) await clearFlow(ctx);
  try {
    if (ev.type === "follow") await welcome(ctx, true);
    else if (ev.type === "message" && ev.message?.type === "text") await onText(ctx, String(ev.message.text || "").trim());
    else if (ev.type === "message" && ev.message?.type === "image") await onSlip(ctx, "slip");
    else if (ev.type === "postback") await onPostback(ctx, Object.fromEntries(new URLSearchParams(ev.postback?.data || "")), ev.postback?.params || {});
  } catch (e) {
    console.error("guestbot", h.slug, e);
    ctx.out = [text(tr(ctx, "ขออภัย ระบบขัดข้องชั่วคราว 🙏 ลองใหม่อีกครั้ง หรือรอทีมงานที่พักตอบกลับนะคะ", "Sorry, something went wrong 🙏 Please try again, or wait for the hotel team to reply."), [qStart(ctx)])];
  }
  if (ctx.out.length && ev.replyToken) await L.replyAs(h.lineChannelToken, ev.replyToken, ctx.out).catch((e) => console.error("guest reply", h.slug, e.message));
}

async function setLang(ctx, v) {
  ctx.lang = v === "en" ? "en" : "th";
  await GuestChat.updateOne({ _id: ctx.chat._id }, { $set: { lang: ctx.lang } });
  return welcome(ctx);
}

async function onText(ctx, t) {
  if (!t) return;
  if (/^(id|userid|user id|ไอดี)$/i.test(t)) return ctx.say(text(`userId ของคุณคือ:\n${ctx.uid}\n(เจ้าของที่พัก: นำไปวางในช่อง "LINE ผู้รับแจ้งเตือน" ในหน้าตั้งค่า)`));
  if (/^(english|eng|en)$/i.test(t)) return setLang(ctx, "en");
  if (/^(ไทย|ภาษาไทย|thai|th)$/i.test(t)) return setLang(ctx, "th");
  if (/^(ยกเลิก|cancel|stop)$/i.test(t)) { await clearFlow(ctx); return ctx.say(text(tr(ctx, "ยกเลิกขั้นตอนแล้วค่ะ", "Cancelled."), [qStart(ctx), qMine(ctx)])); }
  if (/^(เมนู|menu|เริ่ม|start|help|hi|hello)$/i.test(t)) { await clearFlow(ctx); return welcome(ctx); }
  if (/^(การจองของฉัน|เช็[คก]การจอง|ดูการจอง|my ?bookings?)/i.test(t)) { await clearFlow(ctx); return myBookings(ctx); }
  if (/^(กิจกรรม|จองกิจกรรม|activit(y|ies)|tours?)$/i.test(t)) { await clearFlow(ctx); return listActs(ctx); }
  // "ห้องว่าง 25/10" / "จอง 25/10" ใช้ได้เสมอ แม้ค้างอยู่กลางขั้นตอน
  const kw = /^(?:เช็[คก]\s*)?(?:ห้องว่าง|ว่างไหม|ว่างมั้ย|จองห้อง|จอง|book|rooms?|availability)\s*(.*)$/i.exec(t);
  if (kw) {
    await clearFlow(ctx);
    const rest = kw[1].trim(), today = todayTH();
    const din = !rest ? null : /^(วันนี้|today)$/i.test(rest) ? today : /^(พรุ่งนี้|tomorrow)$/i.test(rest) ? addDays(today, 1) : parseDate(rest);
    return din && din >= today && din <= addDays(today, 730) ? askNights(ctx, { din }) : askDin(ctx);
  }
  if (ctx.chat.flow === "bk") return flowText(ctx, t);
  if (/(ห้องว่าง|ว่างไหม|ว่างมั้ย|ราคาห้อง|ค่าห้อง|available|vacancy)/i.test(t)) return askDin(ctx);
  // ข้อความทั่วไป (เช่น ถามทาง) — ให้ทีมที่พักตอบเอง บอทโชว์เมนูไม่เกินทุก 12 ชม.
  const last = ctx.chat.lastNudgeAt ? new Date(ctx.chat.lastNudgeAt).getTime() : 0;
  if (Date.now() - last < NUDGE_EVERY) return;
  await GuestChat.updateOne({ _id: ctx.chat._id }, { $set: { lastNudgeAt: new Date() } });
  return welcome(ctx);
}

async function onPostback(ctx, p, params) {
  switch (p.g) {
    case "menu": await clearFlow(ctx); return welcome(ctx);
    case "lang": return setLang(ctx, p.v);
    case "x": await clearFlow(ctx); return ctx.say(text(tr(ctx, "ยกเลิกขั้นตอนแล้วค่ะ", "Cancelled."), [qStart(ctx), qMine(ctx)]));
    case "start": await clearFlow(ctx); return askDin(ctx);
    case "acts": await clearFlow(ctx); return listActs(ctx);
    case "act": await clearFlow(ctx); return pickAct(ctx, p.id);
    case "my": await clearFlow(ctx); return myBookings(ctx);
    case "paid": return onSlip(ctx, "button", p.ref);
    case "pay2": return payAgain(ctx, p.ref);
    case "cx": return askCancel(ctx, p.ref);
    case "cxok": return doCancel(ctx, p.ref);
  }
  if (ctx.chat.flow !== "bk") return stale(ctx);
  const d = { ...(ctx.chat.data || {}) };
  switch (p.g) {
    case "din": return setDin(ctx, params.date || p.d);
    case "out": return setDout(ctx, d, params.date || p.d);
    case "n": return d.din ? setDout(ctx, d, addDays(d.din, Math.max(1, Math.min(30, parseInt(p.n, 10) || 1)))) : askDin(ctx);
    case "redate": return d.kind === "act" ? askActDate(ctx, d) : askDin(ctx);
    case "room": return pickRoom(ctx, d, p.id);
    case "pax": return setPax(ctx, d, p.n);
    case "eb": return setEb(ctx, d, p.n);
    case "bf": if (ctx.chat.step !== "bf") return stale(ctx); d.bf = p.v === "1"; return askAddons(ctx, d, true);
    case "ad": return pickAddon(ctx, d, p.id);
    case "adq": return setAddonQty(ctx, d, p.n);
    case "adlist": return askAddons(ctx, d, true);
    case "adclr": if (!["addon", "adqty"].includes(ctx.chat.step)) return stale(ctx); d.addons = {}; return askAddons(ctx, d);
    case "adok": if (!["addon", "adqty"].includes(ctx.chat.step)) return stale(ctx); return askName(ctx, d);
    case "adt": return setActDate(ctx, d, params.date || p.d);
    case "atm": return setActTime(ctx, d, p.t);
    case "aq": return setActQty(ctx, d, p.n);
    case "nm": if (ctx.chat.step !== "name" || !ctx.chat.name) return stale(ctx); d.name = ctx.chat.name; return askTel(ctx, d);
    case "pay": return setPay(ctx, d, p.v);
    case "ok": return d.kind === "act" ? confirmAct(ctx) : confirmBooking(ctx);
  }
  return stale(ctx);
}

// ================================================================ menu
const actList = (h) => Service.find({ hotel: h._id, hidden: { $ne: true } }).sort("sort").lean().then((l) => l.filter(sellsStandalone));

async function welcome(ctx, first = false) {
  const h = ctx.h, si = stayInfo(h);
  const [hasCover, acts] = await Promise.all([
    https(h.coverUrl) || (B() && Hotel.exists({ _id: h._id, coverData: { $nin: [null, ""] } })),
    actList(h),
  ]);
  const hero = https(h.coverUrl) || (hasCover ? `${B()}/api/public/img/cover/${h._id}/0?w=line&v=${new Date(h.updatedAt || 0).getTime()}` : "");
  ctx.say(flex(`${h.name} — ${tr(ctx, "เช็คห้องว่างและจองได้ในแชทนี้", "check availability and book in this chat")}`, bubble({
    hero: hero || undefined,
    tag: first ? tr(ctx, "ยินดีต้อนรับ 🌿", "Welcome 🌿") : tr(ctx, "จองห้องพัก", "Book a stay"),
    title: h.name, sub: (ctx.lang === "th" && h.tagline) || tr(ctx, "เช็คห้องว่าง จอง และชำระเงินได้ในแชทนี้เลยค่ะ", "Check availability, book and pay right here in the chat."),
    lines: [
      si.checkInTime || si.checkOutTime ? kv(tr(ctx, "เช็คอิน / เช็คเอาท์", "Check-in / out"), `${si.checkInTime || "-"} / ${si.checkOutTime || "-"}`) : null,
    ],
    buttons: [
      btn(pb(tr(ctx, "🔎 เช็คห้องว่าง & จอง", "🔎 Rooms & booking"), "g=start", tr(ctx, "เช็คห้องว่าง", "Check rooms"))),
      acts.length ? btn(pb(tr(ctx, "🎟 จองกิจกรรม", "🎟 Book an activity"), "g=acts", tr(ctx, "จองกิจกรรม", "Activities")), "secondary") : null,
      btn(pb(tr(ctx, "📋 การจองของฉัน", "📋 My bookings"), "g=my", tr(ctx, "การจองของฉัน", "My bookings")), "secondary"),
      bookUrl(h) ? btn(uri(tr(ctx, "🌐 ดูรูปและรายละเอียด", "🌐 Photos & details"), bookUrl(h)), "link") : null,
      telUri(h.phone) ? btn(uri(tr(ctx, "📞 โทรหาที่พัก", "📞 Call the hotel"), telUri(h.phone)), "link") : null,
      si.mapUrl ? btn(uri(tr(ctx, "📍 แผนที่", "📍 Map"), si.mapUrl), "link") : null,
    ],
  }), homeQuick(ctx, acts.length)));
}

// ================================================================ วันเข้าพัก
function dateQuick(ctx, g, max) {
  const today = todayTH();
  return [
    q(tr(ctx, "วันนี้", "Today"), `g=${g}&d=${today}`, tr(ctx, "วันนี้", "Today")), q(tr(ctx, "พรุ่งนี้", "Tomorrow"), `g=${g}&d=${addDays(today, 1)}`, tr(ctx, "พรุ่งนี้", "Tomorrow")),
    q(tr(ctx, "ศุกร์นี้", "This Fri"), `g=${g}&d=${nextDow(today, 5)}`, tr(ctx, "ศุกร์นี้", "This Friday")), q(tr(ctx, "เสาร์นี้", "This Sat"), `g=${g}&d=${nextDow(today, 6)}`, tr(ctx, "เสาร์นี้", "This Saturday")),
    qDate(tr(ctx, "📅 เลือกวัน", "📅 Pick a date"), "g=" + g, { initial: today, min: today, max: addDays(today, max) }), qCancel(ctx)];
}
function askDin(ctx) {
  return ask(ctx, "din", {}, text(tr(ctx, "📅 เข้าพักวันไหนคะ?\nกดเลือก หรือพิมพ์วันที่ เช่น 25/10", "📅 When would you like to check in?\nTap a date or type one, e.g. 25/10"), dateQuick(ctx, "din", 730)));
}
function setDin(ctx, date) {
  const today = todayTH();
  if (!YMD_RE.test(String(date || "")) || date < today || date > addDays(today, 730)) return ctx.say(text(tr(ctx, "เลือกวันตั้งแต่วันนี้เป็นต้นไปนะคะ", "Please choose today or a later date."), [qCancel(ctx)]));
  return askNights(ctx, { din: date });
}
function askNights(ctx, d) {
  return ask(ctx, "dout", { din: d.din }, text(tr(ctx, `🌙 เข้าพัก ${fDate(ctx, d.din)} — พักกี่คืนคะ?\nกดเลือก หรือพิมพ์วันเช็คเอาท์`, `🌙 Check-in ${fDate(ctx, d.din)} — how many nights?\nTap or type your check-out date`), [
    q(nN(ctx, 1), "g=n&n=1", nN(ctx, 1)), q(nN(ctx, 2), "g=n&n=2", nN(ctx, 2)), q(nN(ctx, 3), "g=n&n=3", nN(ctx, 3)),
    qDate(tr(ctx, "📅 เลือกวันออก", "📅 Check-out date"), "g=out", { initial: addDays(d.din, 1), min: addDays(d.din, 1), max: addDays(d.din, 30) }), qCancel(ctx)]));
}
function setDout(ctx, d, date) {
  if (!d.din) return askDin(ctx);
  if (!YMD_RE.test(String(date || "")) || date <= d.din) return ctx.say(text(tr(ctx, "วันเช็คเอาท์ต้องหลังวันเข้าพักนะคะ", "Check-out must be after check-in."), [qCancel(ctx)]));
  if (nightsOf(d.din, date) > 30) return ctx.say(text(tr(ctx, "จองในแชทได้ไม่เกิน 30 คืนค่ะ ถ้าพักนานกว่านี้ รอทีมงานที่พักติดต่อกลับนะคะ", "Chat bookings are limited to 30 nights. For longer stays, the hotel team will contact you."), [qCancel(ctx)]));
  return showRooms(ctx, { din: d.din, dout: date });
}

// ================================================================ ห้องว่าง (นับแบบเดียวกับ /api/public/availability)
async function freeRooms(h, din, dout) {
  const rooms = await RoomType.find({ hotel: h._id, hidden: { $ne: true } }).sort("sort").lean();
  return Promise.all(rooms.map(async (rt) => {
    const booked = await Booking.countDocuments({ roomType: rt._id, status: { $ne: "cancelled" }, checkin: { $lt: dout }, checkout: { $gt: din } });
    return { rt, free: Math.max(0, (rt.qty || 0) - booked), rate: rateFor(rt, din) };
  }));
}

function bfLabel(ctx, bf) {
  return bf.mode === "included" ? tr(ctx, "รวมอาหารเช้า", "Breakfast included")
    : bf.mode === "optional" ? tr(ctx, `เพิ่มอาหารเช้าได้ ${money(bf.price)}/ท่าน/คืน`, `Breakfast ${money(bf.price)}/person/night`)
    : tr(ctx, "ไม่รวมอาหารเช้า", "Breakfast not included");
}

async function showRooms(ctx, d) {
  const n = nightsOf(d.din, d.dout);
  const list = (await freeRooms(ctx.h, d.din, d.dout)).filter((r) => r.free > 0);
  await setFlow(ctx, "room", d);
  const reQ = [q(tr(ctx, "📅 เปลี่ยนวัน", "📅 Change dates"), "g=redate", tr(ctx, "เปลี่ยนวัน", "Change dates")), qCancel(ctx)];
  if (!list.length) {
    return ctx.say(text(tr(ctx, `😢 ขออภัยค่ะ ${fDate(ctx, d.din)} → ${fDate(ctx, d.dout)} ห้องเต็มทุกห้อง\nลองเลือกวันอื่นได้เลยนะคะ`, `😢 Sorry, we're fully booked ${fDate(ctx, d.din)} → ${fDate(ctx, d.dout)}.\nPlease try other dates.`), reQ));
  }
  const bubbles = list.slice(0, 10).map(({ rt, free, rate }) => {
    const short = rate.minNights > n;
    return bubble({
      size: "kilo", hero: roomImg(rt) || undefined,
      title: rt.name, sub: tr(ctx, `พักได้ ${rt.capacity || 2} ท่าน · ว่าง ${free} ห้อง`, `Sleeps ${rt.capacity || 2} · ${free} left`),
      lines: [
        kv(tr(ctx, "ราคา/คืน", "Per night"), money(rate.price)),
        kv(tr(ctx, `รวม ${n} คืน`, `Total ${nN(ctx, n)}`), money(rate.price * n), { weight: "bold", color: C.teal }),
        T(bfLabel(ctx, breakfastOf(rt)), { size: "xs", color: C.muted, margin: "sm" }),
        rt.extraBedPrice > 0 ? T(tr(ctx, `🛏 เพิ่มเตียงเสริมได้ ${money(rt.extraBedPrice)}/คืน`, `🛏 Extra bed ${money(rt.extraBedPrice)}/night`), { size: "xs", color: C.muted, margin: "xs" }) : null,
        rt.description && ctx.lang === "th" ? T(U.cut(rt.description, 90), { size: "xs", color: C.muted, margin: "sm" }) : null,
        short ? T(tr(ctx, `⚠️ ช่วงนี้ต้องพักอย่างน้อย ${rate.minNights} คืน`, `⚠️ Minimum stay ${nN(ctx, rate.minNights)} for these dates`), { size: "xs", color: C.amber, margin: "sm" }) : null,
      ],
      buttons: [short ? btn(pb(tr(ctx, `📅 พัก ${rate.minNights} คืน`, `📅 Stay ${nN(ctx, rate.minNights)}`), `g=n&n=${rate.minNights}`, nN(ctx, rate.minNights)), "secondary")
        : btn(pb(tr(ctx, "เลือกห้องนี้", "Choose this room"), `g=room&id=${rt._id}`, rt.name))],
    });
  });
  ctx.say(text(tr(ctx, `✨ ห้องว่าง ${fDate(ctx, d.din)} → ${fDate(ctx, d.dout)} (${n} คืน)\nเลื่อนดูแล้วกด “เลือกห้องนี้” ได้เลยค่ะ`, `✨ Available ${fDate(ctx, d.din)} → ${fDate(ctx, d.dout)} (${nN(ctx, n)})\nSwipe and tap “Choose this room”.`)),
    flex(tr(ctx, "ห้องว่าง", "Available rooms"), carousel(bubbles), reQ));
}

async function pickRoom(ctx, d, id) {
  if (ctx.chat.step !== "room" || !d.din || !isId(id)) return stale(ctx);
  const rt = await RoomType.findOne({ _id: id, hotel: ctx.h._id, hidden: { $ne: true } }).lean();
  if (!rt) return stale(ctx);
  Object.assign(d, { kind: "room", rt: String(rt._id), rtName: rt.name, cap: Math.max(1, rt.capacity || 2), ebP: Math.max(0, Number(rt.extraBedPrice) || 0), bfMode: breakfastOf(rt).mode, bfPrice: breakfastOf(rt).price, eb: 0, addons: {} });
  const max = paxMax(d), n = Math.min(max, 10);
  return ask(ctx, "pax", d, text(tr(ctx, `👥 “${rt.name}” เข้าพักกี่ท่านคะ? (ห้องนี้พักได้ ${d.cap} ท่าน${d.ebP ? ` · เพิ่มเตียงเสริมได้ถึง ${max} ท่าน` : ""})`, `👥 How many guests for “${rt.name}”? (sleeps ${d.cap}${d.ebP ? `, up to ${max} with extra beds` : ""})`),
    Array.from({ length: n }, (_, i) => q(nP(ctx, i + 1), `g=pax&n=${i + 1}`, nP(ctx, i + 1))).concat(qCancel(ctx))));
}
// เตียงเสริมได้สูงสุด 2 เตียงต่อห้อง (เท่าหน้าเว็บ) — 1 เตียง = 1 ท่าน
const EB_MAX = 2;
const paxMax = (d) => (d.cap || 2) + (d.ebP ? EB_MAX : 0);
function setPax(ctx, d, v) {
  if (ctx.chat.step !== "pax" || !d.rt) return stale(ctx);
  const n = parseInt(v, 10);
  if (!(n >= 1 && n <= paxMax(d))) return ctx.say(text(tr(ctx, `พิมพ์จำนวน 1–${paxMax(d)} ท่านนะคะ`, `Please enter 1–${paxMax(d)} guests.`), [qCancel(ctx)]));
  d.pax = n;
  if (d.ebP) {
    const min = Math.max(0, n - (d.cap || 2));
    return ask(ctx, "eb", d, text(tr(ctx, `🛏 เพิ่มเตียงเสริมไหมคะ? ${money(d.ebP)} / เตียง / คืน${min ? `\nเข้าพัก ${n} ท่าน ต้องเพิ่มอย่างน้อย ${min} เตียงค่ะ` : ""}`, `🛏 Add an extra bed? ${money(d.ebP)} / bed / night${min ? `\nFor ${nP(ctx, n)} you need at least ${min}.` : ""}`),
      Array.from({ length: EB_MAX - min + 1 }, (_, i) => i + min).map((k) => q(k ? tr(ctx, `${k} เตียง`, `${k} bed${k > 1 ? "s" : ""}`) : tr(ctx, "ไม่ต้องการ", "No thanks"), `g=eb&n=${k}`, k ? tr(ctx, `เตียงเสริม ${k} เตียง`, `${k} extra bed(s)`) : tr(ctx, "ไม่เพิ่มเตียงเสริม", "No extra bed"))).concat(qCancel(ctx))));
  }
  d.eb = 0;
  return askBf(ctx, d);
}
function setEb(ctx, d, v) {
  if (ctx.chat.step !== "eb" || !d.rt) return stale(ctx);
  const k = parseInt(v, 10), min = Math.max(0, (d.pax || 1) - (d.cap || 2));
  if (!(k >= min && k <= EB_MAX)) return ctx.say(text(tr(ctx, `เลือกเตียงเสริม ${min}–${EB_MAX} เตียงนะคะ`, `Please choose ${min}–${EB_MAX} extra beds.`), [qCancel(ctx)]));
  d.eb = k;
  return askBf(ctx, d);
}
function askBf(ctx, d) {
  if (d.bfMode === "optional") {
    return ask(ctx, "bf", d, text(tr(ctx, `🍳 เพิ่มอาหารเช้าไหมคะ?\n${money(d.bfPrice)} / ท่าน / คืน`, `🍳 Add breakfast?\n${money(d.bfPrice)} / person / night`), [
      q(tr(ctx, "เพิ่มอาหารเช้า", "Add breakfast"), "g=bf&v=1", tr(ctx, "เพิ่มอาหารเช้า", "Add breakfast")), q(tr(ctx, "ไม่เอา", "No thanks"), "g=bf&v=0", tr(ctx, "ไม่เอาอาหารเช้า", "No breakfast")), qCancel(ctx)]));
  }
  d.bf = false;
  return askAddons(ctx, d, true);
}

// ---------- บริการเสริม/กิจกรรมที่ซื้อพ่วงได้ (ราคาและการกรองเหมือนหน้าเว็บ — ตรวจซ้ำอีกครั้งใน createRoomBooking)
const addonList = (h) => Service.find({ hotel: h._id, hidden: { $ne: true } }).sort("sort").lean().then((l) => l.filter((s) => sellsAddon(s) && s.price > 0));
async function askAddons(ctx, d, showCards = false) {
  const list = await addonList(ctx.h);
  if (!list.length) return askName(ctx, d);
  d.addons = d.addons || {};
  const picked = list.filter((s) => d.addons[s._id]);
  const sum = picked.reduce((t, s) => t + s.price * d.addons[s._id], 0);
  const msgs = [];
  if (showCards) {
    msgs.push(text(tr(ctx, "✨ บริการเสริม / กิจกรรม (ไม่บังคับ)\nกด “➕ เพิ่ม” ที่รายการที่สนใจ หรือกด “ต่อไป” ถ้าไม่ต้องการค่ะ", "✨ Extras & activities (optional)\nTap “➕ Add” on anything you'd like, or “Next” to skip.")));
    msgs.push(flex(tr(ctx, "บริการเสริม", "Extras"), carousel(list.slice(0, 10).map((s) => bubble({
      size: "kilo", hero: svcImg(s) || undefined, title: s.name, sub: `${money(s.price)} ${ctx.lang === "th" ? s.unit || "" : ""}`.trim(),
      lines: [s.description && ctx.lang === "th" ? T(U.cut(s.description, 90), { size: "xs", color: C.muted, margin: "sm" }) : null],
      buttons: [btn(pb(tr(ctx, "➕ เพิ่ม", "➕ Add"), `g=ad&id=${s._id}`, tr(ctx, "เพิ่ม ", "Add ") + s.name), "secondary")],
    })))));
  }
  const head = picked.length
    ? tr(ctx, "เลือกไว้:", "Selected:") + "\n" + picked.map((s) => `• ${s.name} × ${d.addons[s._id]} = ${money(s.price * d.addons[s._id])}`).join("\n") + "\n" + tr(ctx, `รวมบริการเสริม ${money(sum)}`, `Extras total ${money(sum)}`)
    : tr(ctx, "ยังไม่ได้เลือกบริการเสริม", "No extras selected yet");
  const quick = [q(picked.length ? tr(ctx, "✅ ต่อไป", "✅ Next") : tr(ctx, "ไม่ต้องการ · ต่อไป", "Skip · Next"), "g=adok", tr(ctx, "ต่อไป", "Next")),
    showCards ? null : q(tr(ctx, "✨ ดูบริการทั้งหมด", "✨ See all extras"), "g=adlist", tr(ctx, "ดูบริการเสริม", "See extras")),
    picked.length ? q(tr(ctx, "🗑 ล้างที่เลือก", "🗑 Clear"), "g=adclr", tr(ctx, "ล้างบริการเสริม", "Clear extras")) : null, qCancel(ctx)];
  msgs.push(text(head, quick));
  return ask(ctx, "addon", d, ...msgs);
}
const qtyQuick = (ctx, g, n, extra) => Array.from({ length: n }, (_, i) => q(String(i + 1), `g=${g}&n=${i + 1}`, String(i + 1))).concat(extra || null, qCancel(ctx));
async function pickAddon(ctx, d, id) {
  if (!["addon", "adqty"].includes(ctx.chat.step) || !isId(id)) return stale(ctx);
  const s = (await addonList(ctx.h)).find((x) => String(x._id) === String(id));
  if (!s) return ctx.say(text(tr(ctx, "บริการนี้ปิดขายแล้วค่ะ", "This extra is no longer available."), [q(tr(ctx, "✨ ดูบริการทั้งหมด", "✨ See all extras"), "g=adlist", tr(ctx, "ดูบริการเสริม", "See extras")), q(tr(ctx, "ต่อไป", "Next"), "g=adok", tr(ctx, "ต่อไป", "Next"))]));
  d.adPick = String(s._id);
  const perPerson = /ท่าน|คน/.test(s.unit || "");
  return ask(ctx, "adqty", d, text(tr(ctx, `“${s.name}” ${money(s.price)} ${s.unit || ""}\nเอากี่${perPerson ? "ท่าน" : "ครั้ง"}คะ?`, `“${s.name}” ${money(s.price)}\nHow many${perPerson ? " people" : ""}?`),
    qtyQuick(ctx, "adq", Math.min(10, Math.max(4, d.pax || 1)), d.addons && d.addons[s._id] ? q(tr(ctx, "ไม่เอาแล้ว", "Remove"), "g=adq&n=0", tr(ctx, "ไม่เอารายการนี้", "Remove this")) : null)));
}
function setAddonQty(ctx, d, v) {
  if (ctx.chat.step !== "adqty" || !d.adPick) return stale(ctx);
  const k = parseInt(v, 10);
  if (!(k >= 0 && k <= 50)) return ctx.say(text(tr(ctx, "พิมพ์จำนวน 1–50 นะคะ", "Please enter 1–50."), [qCancel(ctx)]));
  d.addons = { ...(d.addons || {}) };
  if (k) d.addons[d.adPick] = k; else delete d.addons[d.adPick];
  delete d.adPick;
  return askAddons(ctx, d);
}

// ================================================================ กิจกรรมเดี่ยว (ไม่ต้องพัก) — ใช้ createActivityBooking ตัวเดียวกับหน้าเว็บ
async function listActs(ctx) {
  const list = await actList(ctx.h);
  if (!list.length) return ctx.say(text(tr(ctx, "ที่พักนี้ยังไม่เปิดจองกิจกรรมเดี่ยวค่ะ", "This hotel doesn't offer activity bookings yet."), [qStart(ctx), qMine(ctx)]));
  ctx.say(text(tr(ctx, "🎟 กิจกรรมที่จองได้ (ไม่ต้องพัก)\nเลื่อนดูแล้วกด “จองกิจกรรมนี้” ได้เลยค่ะ", "🎟 Activities you can book (no stay needed)\nSwipe and tap “Book this”.")),
    flex(tr(ctx, "กิจกรรม", "Activities"), carousel(list.slice(0, 10).map((s) => bubble({
      size: "kilo", hero: svcImg(s) || undefined, title: s.name,
      sub: s.price > 0 ? `${money(s.price)} ${ctx.lang === "th" ? s.unit || "" : ""}`.trim() : tr(ctx, "ไม่มีค่าใช้จ่าย", "Free"),
      lines: [
        (s.times || []).length ? T(tr(ctx, "🕘 รอบ ", "🕘 Times ") + s.times.join(" · "), { size: "xs", color: C.muted, margin: "sm" }) : null,
        s.description && ctx.lang === "th" ? T(U.cut(s.description, 90), { size: "xs", color: C.muted, margin: "sm" }) : null,
      ],
      buttons: [btn(pb(tr(ctx, "จองกิจกรรมนี้", "Book this"), `g=act&id=${s._id}`, s.name))],
    }))), [qStart(ctx), qMine(ctx)]));
}
async function pickAct(ctx, id) {
  if (!isId(id)) return stale(ctx);
  const s = (await actList(ctx.h)).find((x) => String(x._id) === String(id));
  if (!s) return ctx.say(text(tr(ctx, "กิจกรรมนี้ปิดจองแล้วค่ะ", "This activity is no longer available."), [qActs(ctx)]));
  return askActDate(ctx, { kind: "act", svc: String(s._id), svcName: s.name, price: s.price || 0, unit: s.unit || "", times: s.times || [] });
}
function askActDate(ctx, d) {
  return ask(ctx, "adate", { kind: d.kind, svc: d.svc, svcName: d.svcName, price: d.price, unit: d.unit, times: d.times },
    text(tr(ctx, `📅 “${d.svcName}” วันไหนคะ?`, `📅 Which day for “${d.svcName}”?`), dateQuick(ctx, "adt", 365)));
}
async function setActDate(ctx, d, date) {
  if (ctx.chat.step !== "adate" || d.kind !== "act") return stale(ctx);
  const today = todayTH();
  if (!YMD_RE.test(String(date || "")) || date < today || date > addDays(today, 365)) return ctx.say(text(tr(ctx, "เลือกวันตั้งแต่วันนี้เป็นต้นไปนะคะ", "Please choose today or a later date."), [qCancel(ctx)]));
  const svc = await Service.findOne({ _id: d.svc, hotel: ctx.h._id }).lean();
  if (!svc || !sellsStandalone(svc)) return stale(ctx);
  const av = await availability(svc, date);
  d.date = date;
  const reQ = q(tr(ctx, "📅 วันอื่น", "📅 Other day"), "g=redate", tr(ctx, "เปลี่ยนวัน", "Change day"));
  if (av.slots) {
    const open = av.slots.filter((x) => x.left === null || x.left > 0);
    if (!open.length) return ctx.say(text(tr(ctx, `😢 ${fDate(ctx, date)} เต็มทุกรอบแล้วค่ะ`, `😢 ${fDate(ctx, date)} is fully booked.`), [reQ, qCancel(ctx)]));
    return ask(ctx, "atime", d, text(tr(ctx, `🕘 ${fDate(ctx, date)} รอบไหนคะ?`, `🕘 ${fDate(ctx, date)} — which time?`),
      open.slice(0, 10).map((x) => q(x.left === null ? x.time : tr(ctx, `${x.time} (เหลือ ${x.left})`, `${x.time} (${x.left} left)`), `g=atm&t=${encodeURIComponent(x.time)}`, x.time)).concat(reQ, qCancel(ctx))));
  }
  if (av.left === 0) return ctx.say(text(tr(ctx, `😢 ${fDate(ctx, date)} เต็มแล้วค่ะ`, `😢 ${fDate(ctx, date)} is fully booked.`), [reQ, qCancel(ctx)]));
  d.time = ""; d.left = av.left;
  return askActQty(ctx, d);
}
async function setActTime(ctx, d, t) {
  if (ctx.chat.step !== "atime" || !d.date) return stale(ctx);
  const svc = await Service.findOne({ _id: d.svc, hotel: ctx.h._id }).lean();
  if (!svc || !(svc.times || []).includes(t)) return stale(ctx);
  const slot = ((await availability(svc, d.date)).slots || []).find((x) => x.time === t);
  if (!slot || slot.left === 0) return ctx.say(text(tr(ctx, "รอบนี้เพิ่งเต็มค่ะ เลือกรอบอื่นนะคะ", "That time just filled up — please pick another."), [q(tr(ctx, "📅 วันอื่น", "📅 Other day"), "g=redate", tr(ctx, "เปลี่ยนวัน", "Change day"))]));
  d.time = t; d.left = slot.left;
  return askActQty(ctx, d);
}
function askActQty(ctx, d) {
  const n = Math.min(10, d.left == null ? 10 : d.left);
  return ask(ctx, "aqty", d, text(tr(ctx, `👥 กี่ท่านคะ?${d.left != null ? ` (เหลือ ${d.left} ที่)` : ""}`, `👥 How many people?${d.left != null ? ` (${d.left} spots left)` : ""}`), qtyQuick(ctx, "aq", n)));
}
function setActQty(ctx, d, v) {
  if (ctx.chat.step !== "aqty" || !d.date) return stale(ctx);
  const k = parseInt(v, 10), max = d.left == null ? 50 : d.left;
  if (!(k >= 1 && k <= max)) return ctx.say(text(tr(ctx, `พิมพ์จำนวน 1–${max} ท่านนะคะ`, `Please enter 1–${max}.`), [qCancel(ctx)]));
  d.qty = k; d.pax = k;
  return askName(ctx, d);
}

// ================================================================ ชื่อ / เบอร์ / วิธีชำระ (ใช้ร่วมกันทั้งห้องและกิจกรรม)
function askName(ctx, d) {
  return ask(ctx, "name", d, text(tr(ctx, d.kind === "act" ? "👤 ชื่อ-นามสกุลผู้จองค่ะ" : "👤 ชื่อ-นามสกุลผู้เข้าพักค่ะ", "👤 Your full name, please"),
    [ctx.chat.name ? q(tr(ctx, "ใช้ ", "Use ") + fit(ctx.chat.name, 14), "g=nm", ctx.chat.name) : null, qCancel(ctx)]));
}
function askTel(ctx, d) {
  return ask(ctx, "tel", d, text(tr(ctx, "📞 เบอร์โทรที่ติดต่อได้ค่ะ (เช่น 0812345678)", "📞 Your phone number (Thai mobile, e.g. 0812345678 or +66812345678)"), [qCancel(ctx)]));
}
const total = (d) => (d.kind === "act" ? (d.price || 0) * (d.qty || 1) : null);
function askPay(ctx, d) {
  if (d.kind === "act" && !total(d)) { d.pay = ""; return showConfirm(ctx, d); } // กิจกรรมฟรี ไม่ต้องถามวิธีชำระ
  const m = payMethodsOf(ctx.h);
  const opts = [m.promptpay ? ["promptpay", tr(ctx, "📱 พร้อมเพย์", "📱 PromptPay")] : null, m.transfer ? ["transfer", tr(ctx, "🏦 โอนเข้าบัญชี", "🏦 Bank transfer")] : null, m.onsite ? ["onsite", tr(ctx, "💵 จ่ายที่ที่พัก", "💵 Pay on arrival")] : null].filter(Boolean);
  if (opts.length === 1) return setPay(ctx, d, opts[0][0], true);
  return ask(ctx, "pay", d, text(tr(ctx, "💳 ชำระเงินแบบไหนคะ?", "💳 How would you like to pay?"), opts.map(([k, l]) => q(l, "g=pay&v=" + k, l)).concat(qCancel(ctx))));
}
function setPay(ctx, d, v, auto = false) {
  if (!auto && ctx.chat.step !== "pay") return stale(ctx);
  const m = payMethodsOf(ctx.h);
  if (!["promptpay", "transfer", "onsite"].includes(v) || !m[v]) return askPay(ctx, d);
  d.pay = v;
  return showConfirm(ctx, d);
}

async function flowText(ctx, t) {
  const d = { ...(ctx.chat.data || {}) };
  const num = (/\d+/.exec(t) || [""])[0];
  switch (ctx.chat.step) {
    case "din": { const iso = parseDate(t); return iso ? setDin(ctx, iso) : ctx.say(text(tr(ctx, "อ่านวันที่ไม่ออก ลองพิมพ์ เช่น 25/10 หรือ 25 ต.ค. นะคะ", "I couldn't read that date — try e.g. 25/10"), [qCancel(ctx)])); }
    case "adate": { const iso = parseDate(t); return iso ? setActDate(ctx, d, iso) : ctx.say(text(tr(ctx, "อ่านวันที่ไม่ออก ลองพิมพ์ เช่น 25/10 นะคะ", "I couldn't read that date — try e.g. 25/10"), [qCancel(ctx)])); }
    case "dout": {
      const nn = /^(\d{1,2})\s*(คืน|nights?)?$/i.exec(t);
      if (nn) return setDout(ctx, d, addDays(d.din, Math.max(1, +nn[1])));
      const iso = parseDate(t);
      return iso ? setDout(ctx, d, iso) : ctx.say(text(tr(ctx, "พิมพ์จำนวนคืน (เช่น 2) หรือวันเช็คเอาท์ (เช่น 27/10) นะคะ", "Type the number of nights (e.g. 2) or a check-out date (e.g. 27/10)."), [qCancel(ctx)]));
    }
    case "pax": return setPax(ctx, d, num);
    case "eb": return setEb(ctx, d, /^(ไม่|no)/i.test(t) ? 0 : num);
    case "adqty": return setAddonQty(ctx, d, num);
    case "aqty": return setActQty(ctx, d, num);
    case "addon": if (/^(ไม่|ต่อไป|ข้าม|เสร็จ|no|next|skip|ok)/i.test(t)) return askName(ctx, d); break;
    case "name": {
      const nm = t.replace(/\s+/g, " ").trim();
      if (nm.length < 2 || nm.length > 80) return ctx.say(text(tr(ctx, "พิมพ์ชื่อ 2–80 ตัวอักษรนะคะ", "Please type a name of 2–80 characters."), [qCancel(ctx)]));
      d.name = nm; return askTel(ctx, d);
    }
    case "tel": {
      const ph = normPhone(t);
      if (!ph) return ctx.say(text(tr(ctx, "เบอร์โทรไม่ถูกต้องค่ะ ลองใหม่ เช่น 0812345678", "That phone number doesn't look right — try e.g. 0812345678"), [qCancel(ctx)]));
      d.tel = ph; return askPay(ctx, d);
    }
  }
  return ctx.say(text(tr(ctx, "กดเลือกจากปุ่มด้านล่างได้เลยค่ะ หรือพิมพ์ “ยกเลิก” เพื่อเริ่มใหม่", "Please tap one of the buttons below, or type “cancel” to start over."), [qCancel(ctx)]));
}

// ================================================================ ยืนยัน + สร้างการจอง
const payLabel = (ctx, k) => ({
  promptpay: tr(ctx, "พร้อมเพย์ (สแกน QR)", "PromptPay (QR)"), transfer: tr(ctx, "โอนเข้าบัญชีธนาคาร", "Bank transfer"),
  onsite: tr(ctx, "จ่ายที่ที่พัก", "Pay on arrival"), "": tr(ctx, "ไม่มีค่าใช้จ่าย", "Free"),
}[k || ""]);
const confirmButtons = (ctx, d) => [
  btn(pb(tr(ctx, "✅ ยืนยันการจอง", "✅ Confirm booking"), "g=ok", tr(ctx, "ยืนยันการจอง", "Confirm booking"))),
  btn(pb(d.kind === "act" ? tr(ctx, "📅 เปลี่ยนวัน", "📅 Change day") : tr(ctx, "📅 เปลี่ยนวัน/ห้อง", "📅 Change dates/room"), "g=redate", tr(ctx, "เปลี่ยนวัน", "Change dates")), "secondary"),
  btn(pb(tr(ctx, "ยกเลิก", "Cancel"), "g=x", tr(ctx, "ยกเลิก", "Cancel")), "link"),
];
async function showConfirm(ctx, d) {
  if (d.kind === "act") {
    return ask(ctx, "confirm", d, flex(tr(ctx, "ตรวจรายละเอียดก่อนยืนยัน", "Check before confirming"), bubble({
      tag: tr(ctx, "ตรวจก่อนยืนยัน ✍️", "Please check ✍️"), title: d.svcName, sub: `${fDate(ctx, d.date)}${d.time ? " · " + d.time : ""} · ${nP(ctx, d.qty)}`,
      lines: [kv(tr(ctx, "ผู้จอง", "Name"), d.name), kv(tr(ctx, "เบอร์โทร", "Phone"), d.tel), sep(),
        kv(tr(ctx, "ยอดรวม", "Total"), money(total(d)), { weight: "bold", color: C.teal, size: "md" }), kv(tr(ctx, "ชำระ", "Payment"), payLabel(ctx, d.pay))],
      buttons: confirmButtons(ctx, d),
    })));
  }
  const rt = await RoomType.findOne({ _id: d.rt, hotel: ctx.h._id }).lean();
  if (!rt) return stale(ctx);
  const n = nightsOf(d.din, d.dout), rate = rateFor(rt, d.din);
  const bfTotal = d.bf ? d.bfPrice * d.pax * n : 0;
  const eb = d.eb || 0, ebP = Math.max(0, Number(rt.extraBedPrice) || 0), ebTotal = eb * ebP * n;
  const svcs = Object.keys(d.addons || {}).length ? (await addonList(ctx.h)).filter((s) => d.addons[s._id]) : [];
  const adTotal = svcs.reduce((t, s) => t + s.price * d.addons[s._id], 0);
  const sum = rate.price * n + ebTotal + bfTotal + adTotal;
  await ask(ctx, "confirm", d, flex(tr(ctx, "ตรวจรายละเอียดก่อนยืนยันการจอง", "Check before confirming"), bubble({
    tag: tr(ctx, "ตรวจก่อนยืนยัน ✍️", "Please check ✍️"), title: d.rtName, sub: `${fDate(ctx, d.din)} → ${fDate(ctx, d.dout)} · ${nN(ctx, n)} · ${nP(ctx, d.pax)}`,
    lines: [
      kv(tr(ctx, "ผู้เข้าพัก", "Guest"), d.name), kv(tr(ctx, "เบอร์โทร", "Phone"), d.tel),
      kv(tr(ctx, `ห้อง ${n} คืน`, `Room, ${nN(ctx, n)}`), money(rate.price * n)),
      eb ? kv(tr(ctx, `เตียงเสริม ${eb} × ${n} คืน`, `Extra bed ${eb} × ${nN(ctx, n)}`), money(ebTotal)) : null,
      d.bfMode === "included" ? kv(tr(ctx, "อาหารเช้า", "Breakfast"), tr(ctx, "รวมแล้ว", "Included")) : d.bf ? kv(tr(ctx, `อาหารเช้า ${d.pax} ท่าน`, `Breakfast × ${d.pax}`), money(bfTotal)) : null,
      ...svcs.map((s) => kv(`✨ ${s.name} × ${d.addons[s._id]}`, money(s.price * d.addons[s._id]))),
      sep(),
      kv(tr(ctx, "ยอดรวม", "Total"), money(sum), { weight: "bold", color: C.teal, size: "md" }),
      kv(tr(ctx, "ชำระ", "Payment"), payLabel(ctx, d.pay)),
    ],
    buttons: confirmButtons(ctx, d),
  })));
}

// แขก 1 คนค้างจ่ายได้ไม่เกิน MAX_OPEN รายการต่อที่พัก (นับทั้งห้องและกิจกรรม)
async function tooManyOpen(ctx) {
  const today = todayTH(), base = { hotel: ctx.h._id, lineUserId: ctx.uid, status: { $ne: "cancelled" }, payStatus: "unpaid" };
  const open = (await Booking.countDocuments({ ...base, checkout: { $gte: today } })) + (await ActivityBooking.countDocuments({ ...base, date: { $gte: today } }));
  if (open < MAX_OPEN) return false;
  await clearFlow(ctx);
  ctx.say(text(tr(ctx, `คุณมีการจองที่ยังไม่ชำระ ${open} รายการแล้วค่ะ\nชำระหรือรอทีมงานที่พักติดต่อก่อน แล้วค่อยจองเพิ่มนะคะ`, `You already have ${open} unpaid bookings.\nPlease pay for them (or wait for the hotel) before booking more.`), [qMine(ctx)]));
  return true;
}
const claim = (ctx) => GuestChat.findOneAndUpdate({ _id: ctx.chat._id, flow: "bk", step: "confirm" }, { $set: { step: "saving" } }).lean(); // กันกดยืนยันซ้ำ

async function confirmBooking(ctx) {
  const claimed = await claim(ctx);
  if (!claimed) return stale(ctx);
  const d = claimed.data || {}, h = ctx.h;
  if (await tooManyOpen(ctx)) return;
  const out = await createRoomBooking(h, {
    roomTypeId: d.rt, din: d.din, dout: d.dout, name: d.name, tel: d.tel, pax: d.pax,
    payMethod: d.pay, paid: false, breakfast: !!d.bf, breakfastPax: d.pax, note: "จองผ่านแชท LINE",
    extraBed: d.eb || 0, addons: Object.entries(d.addons || {}).map(([serviceId, qty]) => ({ serviceId, qty })),
  }, { lineUserId: ctx.uid });
  if (out.status !== 200) {
    await setFlow(ctx, "room", { din: d.din, dout: d.dout });
    return ctx.say(text(tr(ctx, "😢 จองไม่สำเร็จ: ", "😢 Booking failed: ") + (out.body.error || tr(ctx, "ลองใหม่อีกครั้ง", "please try again")), [q(tr(ctx, "📅 เลือกวัน/ห้องใหม่", "📅 Choose again"), "g=redate", tr(ctx, "เปลี่ยนวัน", "Change dates")), qCancel(ctx)]));
  }
  await clearFlow(ctx);
  const r = out.body;
  ctx.say(flex(`${tr(ctx, "จองแล้ว", "Booked")} ${r.ref} · ${money(r.amount)}`, bubble({
    tag: `🎉 ${tr(ctx, "จองแล้ว", "Booked")} · ${r.ref}`, tagColor: C.sage, title: r.roomName, sub: `${fDate(ctx, r.checkin)} → ${fDate(ctx, r.checkout)} · ${nN(ctx, r.nights)}`,
    lines: [
      kv(tr(ctx, "ผู้เข้าพัก", "Guest"), d.name), kv(tr(ctx, "ยอดรวม", "Total"), money(r.amount), { weight: "bold" }),
      kv(tr(ctx, "สถานะ", "Status"), r.payStatus === "onsite" ? tr(ctx, "จ่ายที่ที่พักตอนเช็คอิน", "Pay on arrival") : tr(ctx, "รอชำระเงิน", "Awaiting payment")),
      T(tr(ctx, "เก็บเลขจองไว้ใช้ตอนเช็คอินนะคะ", "Please keep your booking number for check-in."), { size: "xs", color: C.muted, margin: "md" }),
    ],
  })));
  if (r.payStatus === "onsite") return ctx.say(text(tr(ctx, `✅ เรียบร้อยค่ะ ชำระ ${money(r.amount)} ที่ที่พักตอนเช็คอินได้เลย\nแล้วพบกันนะคะ 🌿`, `✅ All set! Please pay ${money(r.amount)} at check-in.\nSee you soon 🌿`), [qMine(ctx)]));
  payInstructions(ctx, r.payMethod, r.amount, r.holdUntil, r.ref);
}

async function confirmAct(ctx) {
  const claimed = await claim(ctx);
  if (!claimed) return stale(ctx);
  const d = claimed.data || {}, h = ctx.h;
  if (await tooManyOpen(ctx)) return;
  const svc = await Service.findOne({ _id: d.svc, hotel: h._id });
  if (!svc || !sellsStandalone(svc)) { await clearFlow(ctx); return ctx.say(text(tr(ctx, "กิจกรรมนี้ปิดจองแล้วค่ะ", "This activity is no longer available."), [qActs(ctx)])); }
  if (h.approved === false) { await clearFlow(ctx); return ctx.say(text(tr(ctx, "ที่พักนี้ยังไม่เปิดรับจองค่ะ", "This hotel isn't taking bookings yet."))); }
  const pc = (svc.price || 0) > 0 ? resolvePayChoice(h, d.pay, false) : { method: "", payStatus: "unpaid" };
  if (pc.error) { await setFlow(ctx, "pay", d); return ctx.say(text(pc.error, [qCancel(ctx)])); }
  let b;
  try {
    b = await createActivityBooking(h, svc, { date: d.date, time: d.time, qty: d.qty, name: d.name, tel: d.tel, note: "จองผ่านแชท LINE", payStatus: pc.payStatus, payMethod: pc.method, lineUserId: ctx.uid });
  } catch (e) {
    await setFlow(ctx, "adate", { kind: "act", svc: d.svc, svcName: d.svcName, price: d.price, unit: d.unit, times: d.times });
    return ctx.say(text(tr(ctx, "😢 จองไม่สำเร็จ: ", "😢 Booking failed: ") + (e.message || ""), [q(tr(ctx, "📅 เลือกวันใหม่", "📅 Choose again"), "g=redate", tr(ctx, "เปลี่ยนวัน", "Change day")), qCancel(ctx)]));
  }
  await clearFlow(ctx);
  notifyActivity(b._id).catch((e) => console.error("notifyActivity", e.message));
  ctx.say(flex(`${tr(ctx, "จองแล้ว", "Booked")} ${b.ref}`, bubble({
    tag: `🎉 ${tr(ctx, "จองแล้ว", "Booked")} · ${b.ref}`, tagColor: C.sage, title: b.serviceName, sub: `${fDate(ctx, b.date)}${b.time ? " · " + b.time : ""} · ${nP(ctx, b.qty)}`,
    lines: [kv(tr(ctx, "ผู้จอง", "Name"), b.guestName), kv(tr(ctx, "ยอดรวม", "Total"), b.amount ? money(b.amount) : tr(ctx, "ไม่มีค่าใช้จ่าย", "Free"), { weight: "bold" })],
  })));
  if (!b.amount) return ctx.say(text(tr(ctx, "✅ เรียบร้อยค่ะ แล้วพบกันนะคะ 🌿", "✅ All set — see you soon 🌿"), [qMine(ctx)]));
  if (b.payStatus === "onsite") return ctx.say(text(tr(ctx, `✅ เรียบร้อยค่ะ ชำระ ${money(b.amount)} ที่ที่พักในวันใช้บริการได้เลย`, `✅ All set! Please pay ${money(b.amount)} on the day.`), [qMine(ctx)]));
  payInstructions(ctx, b.payMethod, b.amount, null, b.ref);
}

function payInstructions(ctx, method, amount, holdUntil, ref) {
  const h = ctx.h, m = payMethodsOf(h);
  const due = holdUntil ? tr(ctx, `\n⏰ กรุณาชำระภายใน ${fWhen(ctx, holdUntil)} ไม่งั้นระบบจะปล่อยห้องอัตโนมัติ`, `\n⏰ Please pay by ${fWhen(ctx, holdUntil)}, otherwise the room is released automatically.`) : "";
  const quick = [qRoll(tr(ctx, "🖼 ส่งสลิป", "🖼 Send slip")), qCam(tr(ctx, "📷 ถ่ายสลิป", "📷 Photo of slip")), q(tr(ctx, "โอนแล้ว", "I've paid"), "g=paid&ref=" + encodeURIComponent(ref || ""), tr(ctx, "โอนแล้ว", "I've paid")), qMine(ctx)];
  const after = tr(ctx, "\n\nโอนแล้วส่งรูปสลิปในแชทนี้ได้เลยค่ะ 🙏", "\n\nAfter paying, send a photo of your slip in this chat 🙏");
  if (method === "promptpay" && m.promptpay) {
    const qr = B() ? `${B()}/api/public/promptpay-qr?slug=${encodeURIComponent(h.slug)}&amount=${amount}` : "";
    if (qr) ctx.say({ type: "image", originalContentUrl: qr, previewImageUrl: qr });
    return ctx.say(text(tr(ctx, `📱 สแกน QR พร้อมเพย์ด้านบน ยอด ${money(amount)}`, `📱 Scan the PromptPay QR above — ${money(amount)}`) + (qr ? "" : `\nPromptPay: ${formatPromptPayId(h.promptpayId)}`) + due + after, quick));
  }
  const bank = m.bank;
  if (bank) return ctx.say(text(tr(ctx, `🏦 โอนเข้าบัญชี ยอด ${money(amount)}\nธนาคาร${bank.name}\nเลขที่ ${bank.noFmt}\nชื่อบัญชี ${bank.acct}`, `🏦 Bank transfer — ${money(amount)}\nBank: ${bank.name}\nAccount no. ${bank.noFmt}\nName: ${bank.acct}`) + due + after, quick));
  return ctx.say(text(tr(ctx, `ทีมงานที่พักจะติดต่อเรื่องการชำระเงิน ยอด ${money(amount)} นะคะ`, `The hotel team will contact you about paying ${money(amount)}.`), [qMine(ctx)]));
}

// ================================================================ การจองของแขกคนนี้ (ห้อง + กิจกรรม)
async function myItems(ctx) {
  const today = todayTH(), base = { hotel: ctx.h._id, lineUserId: ctx.uid, status: { $ne: "cancelled" } };
  const [rooms, acts] = await Promise.all([
    Booking.find({ ...base, checkout: { $gte: today } }).sort({ checkin: 1 }).limit(30).lean(),
    ActivityBooking.find({ ...base, date: { $gte: today } }).sort({ date: 1 }).limit(20).lean(),
  ]);
  const names = Object.fromEntries((await RoomType.find({ _id: { $in: rooms.map((b) => b.roomType).filter(Boolean) } }).select("name").lean()).map((r) => [String(r._id), r.name]));
  const groups = {};
  for (const b of rooms) {
    const g = groupOf(b.ref) || String(b._id);
    const it = (groups[g] ||= { kind: "room", ref: g, list: [], name: names[String(b.roomType)] || "", start: b.checkin, end: b.checkout, amount: 0, payStatus: b.payStatus || "", payMethod: b.payMethod || "" });
    it.list.push(b); it.amount += b.amount || 0;
  }
  const items = Object.values(groups).concat(acts.map((a) => ({ kind: "act", ref: a.ref, list: [a], name: a.serviceName, start: a.date, time: a.time, qty: a.qty, amount: a.amount || 0, payStatus: a.payStatus || "", payMethod: a.payMethod || "" })));
  return items.sort((x, y) => String(x.start).localeCompare(String(y.start)));
}
const findItem = async (ctx, ref) => (await myItems(ctx)).find((x) => x.ref === String(ref || ""));
const payTh = (ctx, s) => ({
  unpaid: tr(ctx, "⏳ รอชำระ", "⏳ Awaiting payment"), reported: tr(ctx, "💸 แจ้งโอนแล้ว รอตรวจ", "💸 Payment sent, being checked"),
  paid: tr(ctx, "✅ ชำระแล้ว", "✅ Paid"), onsite: tr(ctx, "🤝 จ่ายที่ที่พัก", "🤝 Pay on arrival"),
}[s] || "—");

async function myBookings(ctx) {
  const items = await myItems(ctx);
  if (!items.length) return ctx.say(text(tr(ctx, "ยังไม่มีการจองที่กำลังจะมาถึงค่ะ\n(การจองที่ทำบนหน้าเว็บ เช็กได้ที่หน้าจอง ด้วยเลขจอง + เบอร์โทร)", "You have no upcoming bookings.\n(Bookings made on the website can be found there with your booking number + phone.)"), [qStart(ctx)]));
  const si = stayInfo(ctx.h), canCancel = ctx.h.allowGuestCancel !== false;
  ctx.say(text(tr(ctx, `📋 การจองของคุณ (${items.length})`, `📋 Your bookings (${items.length})`)),
    flex(tr(ctx, "การจองของฉัน", "My bookings"), carousel(items.slice(0, 10).map((it) => bubble({
      size: "kilo", tag: it.ref, tagColor: it.payStatus === "unpaid" ? C.amber : C.sage,
      title: it.name || tr(ctx, "ห้องพัก", "Room"),
      sub: it.kind === "act" ? `${fDate(ctx, it.start)}${it.time ? " · " + it.time : ""} · ${nP(ctx, it.qty)}` : `${fDate(ctx, it.start)} → ${fDate(ctx, it.end)}${it.list.length > 1 ? tr(ctx, ` · ${it.list.length} ห้อง`, ` · ${it.list.length} rooms`) : ""}`,
      lines: [kv(tr(ctx, "ยอด", "Total"), money(it.amount)), kv(tr(ctx, "สถานะ", "Status"), payTh(ctx, it.payStatus))],
      buttons: [
        it.payStatus === "unpaid" && it.amount > 0 ? btn(pb(tr(ctx, "💳 ชำระ / ส่งสลิป", "💳 Pay / send slip"), "g=pay2&ref=" + it.ref, tr(ctx, "วิธีชำระ ", "How to pay ") + it.ref)) : null,
        canCancel ? btn(pb(tr(ctx, "❌ ยกเลิกการจอง", "❌ Cancel booking"), "g=cx&ref=" + it.ref, tr(ctx, "ยกเลิก ", "Cancel ") + it.ref), "secondary") : null,
        si.mapUrl ? btn(uri(tr(ctx, "📍 แผนที่", "📍 Map"), si.mapUrl), "link") : null,
      ],
    }))), [qStart(ctx), qLang(ctx)]));
}

async function payAgain(ctx, ref) {
  const it = await findItem(ctx, ref);
  if (!it || it.payStatus !== "unpaid") return ctx.say(text(tr(ctx, "การจองนี้ไม่ได้รอชำระแล้วค่ะ", "This booking isn't awaiting payment."), [qMine(ctx)]));
  return payInstructions(ctx, it.payMethod, it.amount, null, it.ref);
}

// ---------- ยกเลิกโดยแขก — นโยบายเดียวกับหน้าเว็บ (POST /api/public/cancel): ฟรีถ้ายกเลิกก่อนวันเข้า cancelDays วัน
function cancelTerms(h, it) {
  const days = h.cancelDays ?? 3;
  const deadline = new Date(it.start); deadline.setDate(deadline.getDate() - days);
  return { days, free: new Date() <= deadline };
}
async function askCancel(ctx, ref) {
  if (ctx.h.allowGuestCancel === false) return ctx.say(text(tr(ctx, "ที่พักนี้ไม่เปิดให้ยกเลิกออนไลน์ค่ะ กรุณาติดต่อที่พักโดยตรง", "This hotel doesn't allow online cancellation — please contact the hotel.") + (ctx.h.phone ? `\n📞 ${ctx.h.phone}` : "")));
  const it = await findItem(ctx, ref);
  if (!it) return ctx.say(text(tr(ctx, "ไม่พบการจองนี้ (หรือยกเลิกไปแล้ว)", "Booking not found (or already cancelled)."), [qMine(ctx)]));
  const { days, free } = cancelTerms(ctx.h, it);
  const paid = ["paid", "reported"].includes(it.payStatus);
  const policy = free ? tr(ctx, `✅ ยกเลิกฟรี (ยกเลิกก่อนวันเข้า ${days} วัน)`, `✅ Free cancellation (${days}+ days before)`)
    : tr(ctx, `⚠️ เลยกำหนดยกเลิกฟรีแล้ว (ต้องยกเลิกก่อนวันเข้า ${days} วัน) — อาจมีค่าใช้จ่ายตามเงื่อนไขของที่พัก`, `⚠️ Past the free-cancellation deadline (${days} days before) — the hotel's terms may apply.`);
  ctx.say(flex(tr(ctx, "ยืนยันยกเลิก ", "Cancel ") + it.ref, bubble({
    tag: tr(ctx, "ยกเลิกการจอง", "Cancel booking") + " · " + it.ref, tagColor: C.red, title: it.name || "",
    sub: it.kind === "act" ? fDate(ctx, it.start) : `${fDate(ctx, it.start)} → ${fDate(ctx, it.end)}`,
    lines: [T(policy, { size: "sm", wrap: true, margin: "sm" }),
      paid ? T(tr(ctx, "💸 คุณชำระ/แจ้งโอนแล้ว — ที่พักจะติดต่อเรื่องการคืนเงินตามนโยบาย", "💸 You've paid — the hotel will contact you about any refund per its policy."), { size: "xs", color: C.amber, wrap: true, margin: "md" }) : null],
    buttons: [btn(pb(tr(ctx, "ยืนยันยกเลิก", "Yes, cancel it"), "g=cxok&ref=" + it.ref, tr(ctx, "ยืนยันยกเลิก ", "Confirm cancel ") + it.ref), "primary", C.red),
      btn(pb(tr(ctx, "ไม่ยกเลิก", "Keep booking"), "g=my", tr(ctx, "ไม่ยกเลิก", "Keep booking")), "link")],
  })));
}
async function doCancel(ctx, ref) {
  if (ctx.h.allowGuestCancel === false) return askCancel(ctx, ref);
  const it = await findItem(ctx, ref);
  if (!it) return ctx.say(text(tr(ctx, "ไม่พบการจองนี้ (หรือยกเลิกไปแล้ว)", "Booking not found (or already cancelled)."), [qMine(ctx)]));
  const { free } = cancelTerms(ctx.h, it);
  const ids = it.list.map((b) => b._id);
  // ยกเลิกเฉพาะรายการที่ยังไม่ถูกยกเลิก (กันกดซ้ำ / แข่งกับระบบปล่อยห้อง)
  const res = it.kind === "act"
    ? await ActivityBooking.updateMany({ _id: { $in: ids }, status: { $ne: "cancelled" } }, { $set: { status: "cancelled" } })
    : await Booking.updateMany({ _id: { $in: ids }, status: { $ne: "cancelled" } }, { $set: { status: "cancelled", cancelReason: "guest", cancelledAt: new Date() } });
  if (!res.modifiedCount) return ctx.say(text(tr(ctx, "การจองนี้ถูกยกเลิกไปแล้วค่ะ", "This booking was already cancelled."), [qMine(ctx)]));
  notifyCancel(ctx.h._id, it.list, { by: "guest", free }).catch((e) => console.error("notifyCancel", e.message));
  ctx.say(text(tr(ctx, `✅ ยกเลิกการจอง ${it.ref} แล้วค่ะ${free ? "" : "\nที่พักจะติดต่อเรื่องค่าใช้จ่าย (ถ้ามี)"}`, `✅ Booking ${it.ref} has been cancelled.${free ? "" : "\nThe hotel will contact you about any charges."}`), [qStart(ctx), qMine(ctx)]));
}

// ================================================================ แจ้งโอน (ส่งรูปสลิป / กด "โอนแล้ว")
// สลิปอยู่ในแชท OA ของโรงแรมให้ทีมดูได้เลย — ระบบแค่เปลี่ยนสถานะเป็น "แจ้งโอนแล้ว" แล้วแจ้งที่พัก
async function onSlip(ctx, how, ref) {
  const items = (await myItems(ctx)).filter((x) => x.payStatus === "unpaid" && x.amount > 0);
  // ระบุเลขจองมา (ปุ่ม "โอนแล้ว") ใช้อันนั้น · ส่งรูปเฉย ๆ ใช้รายการที่จองล่าสุด
  const it = (ref && items.find((x) => x.ref === ref)) || items.sort((a, b) => new Date(b.list[0].createdAt || 0) - new Date(a.list[0].createdAt || 0))[0];
  if (!it) {
    if (how === "slip") return; // รูปทั่วไป (ไม่มีการจองรอชำระ) — ปล่อยให้ทีมที่พักดูเอง
    return ctx.say(text(tr(ctx, "ไม่พบการจองที่รอชำระค่ะ", "No bookings are awaiting payment."), [qMine(ctx), qStart(ctx)]));
  }
  const payRef = how === "slip" ? "ส่งสลิปในแชท LINE OA" : "แจ้งโอนในแชท LINE OA (ยังไม่ส่งสลิป)";
  const Model = it.kind === "act" ? ActivityBooking : Booking;
  await Model.updateMany({ _id: { $in: it.list.map((b) => b._id) }, status: { $ne: "cancelled" }, payStatus: "unpaid" }, { $set: { payStatus: "reported", payRef } });
  notifyPaidReport(it.kind === "act" ? "act" : "room", it.list[0]._id).catch((e) => console.error("notifyPaidReport", e.message));
  ctx.say(text(tr(ctx, `📩 ได้รับ${how === "slip" ? "สลิป" : "แจ้งโอน"}แล้วค่ะ (${it.ref})\nทีมงานกำลังตรวจยอด ยืนยันแล้วจะแจ้งในแชทนี้นะคะ 🙏${how === "slip" ? "" : "\n\nถ้ามีสลิป ส่งรูปมาในแชทนี้ได้เลยค่ะ"}`,
    `📩 Got your ${how === "slip" ? "slip" : "payment notice"} (${it.ref}).\nThe hotel is checking it and will confirm in this chat 🙏${how === "slip" ? "" : "\n\nIf you have a slip, please send a photo of it here."}`), [qMine(ctx)]));
}
