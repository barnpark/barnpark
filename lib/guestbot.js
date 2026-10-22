// =====================================================================
//  บอทจองห้องของแขก — ทำงานใน LINE OA ของแต่ละโรงแรม (webhook /api/line/webhook/<slug>)
//  แขกทักมา → เช็คห้องว่าง → เลือกห้อง → จำนวนท่าน → (อาหารเช้า) → ชื่อ/เบอร์ → วิธีชำระ → ยืนยัน
//  → ได้ QR พร้อมเพย์ / เลขบัญชี → ส่งรูปสลิปในแชท → แจ้งที่พักตรวจ → ที่พักกดยืนยัน → แจ้งแขก (notifyGuestPaid)
//  จองด้วย createRoomBooking ตัวเดียวกับหน้าเว็บ (ราคา ขั้นต่ำคืน กันจองซ้อน ปล่อยห้องค้างจ่าย เหมือนกันทุกอย่าง)
//  ตอบด้วย reply ของ OA โรงแรม (ฟรี) · สลิปอยู่ในแชท OA ของโรงแรมเอง ไม่เก็บลงฐานข้อมูล
// =====================================================================
import mongoose from "mongoose";
import GuestChat from "../models/GuestChat.js";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Service from "../models/Service.js";
import Booking from "../models/Booking.js";
import * as L from "./line.js";
import * as U from "./lineui.js";
import { baseUrl } from "./baseurl.js";
import { rateFor } from "./pricing.js";
import { breakfastOf, bfText, stayInfo } from "./stay.js";
import { payMethodsOf } from "./pay.js";
import { formatPromptPayId } from "./promptpay.js";
import { createRoomBooking } from "./booking.js";
import { sellsAddon } from "./activity.js";
import { notifyPaidReport } from "./notify.js";
import { parseDate, normPhone, todayTH } from "./linebot.js";

const { C, q, qDate, qRoll, qCam, text, flex, bubble, carousel, btn, pb, uri, T, kv, sep, money, fit } = U;

const FLOW_TTL = 3 * 3600e3;          // ขั้นตอนที่ค้างเกิน 3 ชม. เริ่มใหม่
const NUDGE_EVERY = 12 * 3600e3;      // ข้อความทั่วไป (ไม่ใช่คำสั่ง) ตอบเมนูไม่เกินทุก 12 ชม. — ให้ทีมที่พักคุยเองได้
const MAX_OPEN = 3;                   // แขก 1 คน จองค้างจ่ายได้พร้อมกันไม่เกิน 3 รายการต่อที่พัก (กันกดจองเล่นจนห้องเต็ม)
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_D = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nightsOf = (a, b) => Math.max(0, Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5));
const thDate = (ymd) => { const d = new Date(ymd + "T00:00:00Z"); return isNaN(d) ? ymd : `${TH_D[d.getUTCDay()]} ${d.getUTCDate()} ${TH_M[d.getUTCMonth()]}`; };
const thWhen = (dt) => { const d = new Date(new Date(dt).getTime() + 7 * 3600e3); return `${d.getUTCDate()} ${TH_M[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} น.`; };
const nextDow = (ymd, dow) => addDays(ymd, (dow - new Date(ymd + "T00:00:00Z").getUTCDay() + 7) % 7);
const isId = (s) => mongoose.isValidObjectId(String(s || ""));
const https = (u) => (/^https:\/\//.test(String(u || "")) ? u : "");
const B = () => https(baseUrl());
const bookUrl = (h) => (B() ? `${B()}/book.html?h=${encodeURIComponent(h.slug)}` : "");
const roomImg = (rt) => https(rt.images && rt.images[0]) || (B() && ((rt.images && rt.images[0]) || rt.imageUrl) ? `${B()}/api/public/img/room/${rt._id}/0?w=line&v=${new Date(rt.updatedAt || 0).getTime()}` : "") || https(rt.imageUrl);
const telUri = (t) => { const d = String(t || "").replace(/[^\d+]/g, ""); return d.length >= 9 ? "tel:" + d : ""; };
const qCancel = () => q("✖ ยกเลิก", "g=x", "ยกเลิก");
const qHome = () => q("🏠 เมนู", "g=menu", "เมนู");
const qStart = () => q("🔎 เช็คห้องว่าง", "g=start", "เช็คห้องว่าง");
const qMine = () => q("📋 การจองของฉัน", "g=my", "การจองของฉัน");

// ---------------------------------------------------------------- state
async function loadChat(h, uid) {
  let chat = await GuestChat.findOne({ hotel: h._id, userId: uid }).lean();
  if (!chat) {
    try { await GuestChat.create({ hotel: h._id, userId: uid }); } catch (e) { if (e?.code !== 11000) throw e; }
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
const stale = (ctx) => ctx.say(text("ขั้นตอนนี้หมดเวลาแล้ว เริ่มใหม่ได้เลยค่ะ 🙏", [qStart(), qMine()]));

// ================================================================ entry
// h = โรงแรม (lean, มี lineChannelToken) · เรียกหลังตรวจลายเซ็น webhook แล้วเท่านั้น
export async function handleGuestEvent(h, ev) {
  const uid = ev?.source?.userId;
  if (!uid || ev.source.type !== "user" || ev.type === "unfollow") return;
  const chat = await loadChat(h, uid);
  const ctx = { h, uid, chat, ev, out: [], say(...m) { for (const x of m.flat()) if (x) this.out.push(x); } };
  if (chat.flow && (!chat.flowAt || Date.now() - new Date(chat.flowAt).getTime() > FLOW_TTL)) await clearFlow(ctx);
  try {
    if (ev.type === "follow") await welcome(ctx, true);
    else if (ev.type === "message" && ev.message?.type === "text") await onText(ctx, String(ev.message.text || "").trim());
    else if (ev.type === "message" && ev.message?.type === "image") await onSlip(ctx, "slip");
    else if (ev.type === "postback") await onPostback(ctx, Object.fromEntries(new URLSearchParams(ev.postback?.data || "")), ev.postback?.params || {});
  } catch (e) {
    console.error("guestbot", h.slug, e);
    ctx.out = [text("ขออภัย ระบบขัดข้องชั่วคราว 🙏 ลองใหม่อีกครั้ง หรือรอทีมงานที่พักตอบกลับนะคะ", [qStart()])];
  }
  if (ctx.out.length && ev.replyToken) await L.replyAs(h.lineChannelToken, ev.replyToken, ctx.out).catch((e) => console.error("guest reply", h.slug, e.message));
}

async function onText(ctx, t) {
  if (!t) return;
  if (/^(id|userid|user id|ไอดี)$/i.test(t)) return ctx.say(text(`userId ของคุณคือ:\n${ctx.uid}\n(เจ้าของที่พัก: นำไปวางในช่อง "LINE ผู้รับแจ้งเตือน" ในหน้าตั้งค่า)`));
  if (/^(ยกเลิก|cancel|stop)$/i.test(t)) { await clearFlow(ctx); return ctx.say(text("ยกเลิกขั้นตอนแล้วค่ะ", [qStart(), qMine()])); }
  if (/^(เมนู|menu|เริ่ม|start|help)$/i.test(t)) { await clearFlow(ctx); return welcome(ctx); }
  if (/^(การจองของฉัน|เช็[คก]การจอง|ดูการจอง|my ?booking)/i.test(t)) return myBookings(ctx);
  // "ห้องว่าง 25/10" / "จอง 25/10" ใช้ได้เสมอ แม้ค้างอยู่กลางขั้นตอน
  const kw = /^(?:เช็[คก]\s*)?(?:ห้องว่าง|ว่างไหม|ว่างมั้ย|จองห้อง|จอง|book)\s*(.*)$/i.exec(t);
  if (kw) {
    await clearFlow(ctx);
    const rest = kw[1].trim(), today = todayTH();
    const din = !rest ? null : rest === "วันนี้" ? today : rest === "พรุ่งนี้" ? addDays(today, 1) : parseDate(rest);
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
    case "x": await clearFlow(ctx); return ctx.say(text("ยกเลิกขั้นตอนแล้วค่ะ", [qStart(), qMine()]));
    case "start": await clearFlow(ctx); return askDin(ctx);
    case "my": return myBookings(ctx);
    case "paid": return onSlip(ctx, "button");
  }
  if (ctx.chat.flow !== "bk") return stale(ctx);
  const d = { ...(ctx.chat.data || {}) };
  switch (p.g) {
    case "din": return setDin(ctx, params.date || p.d);
    case "out": return setDout(ctx, d, params.date || p.d);
    case "n": return d.din ? setDout(ctx, d, addDays(d.din, Math.max(1, Math.min(30, parseInt(p.n, 10) || 1)))) : askDin(ctx);
    case "redate": return askDin(ctx);
    case "room": return pickRoom(ctx, d, p.id);
    case "pax": return setPax(ctx, d, p.n);
    case "eb": return setEb(ctx, d, p.n);
    case "bf": if (ctx.chat.step !== "bf") return stale(ctx); d.bf = p.v === "1"; return askAddons(ctx, d, true);
    case "ad": return pickAddon(ctx, d, p.id);
    case "adq": return setAddonQty(ctx, d, p.n);
    case "adlist": return askAddons(ctx, d, true);
    case "adclr": if (!["addon", "adqty"].includes(ctx.chat.step)) return stale(ctx); d.addons = {}; return askAddons(ctx, d);
    case "adok": if (!["addon", "adqty"].includes(ctx.chat.step)) return stale(ctx); return askName(ctx, d);
    case "nm": if (ctx.chat.step !== "name" || !ctx.chat.name) return stale(ctx); d.name = ctx.chat.name; return askTel(ctx, d);
    case "pay": return setPay(ctx, d, p.v);
    case "ok": return confirmBooking(ctx);
  }
  return stale(ctx);
}

// ================================================================ menu
async function welcome(ctx, first = false) {
  const h = ctx.h, si = stayInfo(h);
  const hasCover = https(h.coverUrl) || (B() && await Hotel.exists({ _id: h._id, coverData: { $nin: [null, ""] } }));
  const hero = https(h.coverUrl) || (hasCover ? `${B()}/api/public/img/cover/${h._id}/0?w=line&v=${new Date(h.updatedAt || 0).getTime()}` : "");
  ctx.say(flex(`${h.name} — เช็คห้องว่างและจองได้ในแชทนี้`, bubble({
    hero: hero || undefined,
    tag: first ? "ยินดีต้อนรับ 🌿" : "จองห้องพัก",
    title: h.name, sub: h.tagline || "เช็คห้องว่าง จอง และชำระเงินได้ในแชทนี้เลยค่ะ",
    lines: [
      si.checkInTime || si.checkOutTime ? kv("เช็คอิน / เช็คเอาท์", `${si.checkInTime || "-"} / ${si.checkOutTime || "-"}`) : null,
    ],
    buttons: [
      btn(pb("🔎 เช็คห้องว่าง & จอง", "g=start", "เช็คห้องว่าง")),
      btn(pb("📋 การจองของฉัน", "g=my", "การจองของฉัน"), "secondary"),
      bookUrl(h) ? btn(uri("🌐 ดูรูปและรายละเอียด", bookUrl(h)), "link") : null,
      telUri(h.phone) ? btn(uri("📞 โทรหาที่พัก", telUri(h.phone)), "link") : null,
      si.mapUrl ? btn(uri("📍 แผนที่", si.mapUrl), "link") : null,
    ],
  }), [qStart(), qMine()]));
}

// ================================================================ วันเข้าพัก
function askDin(ctx) {
  const today = todayTH();
  return ask(ctx, "din", {}, text("📅 เข้าพักวันไหนคะ?\nกดเลือก หรือพิมพ์วันที่ เช่น 25/10", [
    q("วันนี้", "g=din&d=" + today, "วันนี้"), q("พรุ่งนี้", "g=din&d=" + addDays(today, 1), "พรุ่งนี้"),
    q("ศุกร์นี้", "g=din&d=" + nextDow(today, 5), "ศุกร์นี้"), q("เสาร์นี้", "g=din&d=" + nextDow(today, 6), "เสาร์นี้"),
    qDate("📅 เลือกวัน", "g=din", { initial: today, min: today, max: addDays(today, 730) }), qCancel()]));
}
function setDin(ctx, date) {
  const today = todayTH();
  if (!YMD_RE.test(String(date || "")) || date < today || date > addDays(today, 730)) return ctx.say(text("เลือกวันตั้งแต่วันนี้เป็นต้นไปนะคะ", [qCancel()]));
  return askNights(ctx, { din: date });
}
function askNights(ctx, d) {
  return ask(ctx, "dout", { din: d.din }, text(`🌙 เข้าพัก ${thDate(d.din)} — พักกี่คืนคะ?\nกดเลือก หรือพิมพ์วันเช็คเอาท์`, [
    q("1 คืน", "g=n&n=1", "1 คืน"), q("2 คืน", "g=n&n=2", "2 คืน"), q("3 คืน", "g=n&n=3", "3 คืน"),
    qDate("📅 เลือกวันออก", "g=out", { initial: addDays(d.din, 1), min: addDays(d.din, 1), max: addDays(d.din, 30) }), qCancel()]));
}
function setDout(ctx, d, date) {
  if (!d.din) return askDin(ctx);
  if (!YMD_RE.test(String(date || "")) || date <= d.din) return ctx.say(text("วันเช็คเอาท์ต้องหลังวันเข้าพักนะคะ", [qCancel()]));
  if (nightsOf(d.din, date) > 30) return ctx.say(text("จองในแชทได้ไม่เกิน 30 คืนค่ะ ถ้าพักนานกว่านี้ รอทีมงานที่พักติดต่อกลับนะคะ", [qCancel()]));
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

async function showRooms(ctx, d) {
  const n = nightsOf(d.din, d.dout);
  const list = (await freeRooms(ctx.h, d.din, d.dout)).filter((r) => r.free > 0);
  await setFlow(ctx, "room", d);
  if (!list.length) {
    return ctx.say(text(`😢 ขออภัยค่ะ ${thDate(d.din)} → ${thDate(d.dout)} ห้องเต็มทุกห้อง\nลองเลือกวันอื่นได้เลยนะคะ`, [q("📅 เปลี่ยนวัน", "g=redate", "เปลี่ยนวัน"), qCancel()]));
  }
  const bubbles = list.slice(0, 10).map(({ rt, free, rate }) => {
    const short = rate.minNights > n;
    const bf = breakfastOf(rt);
    return bubble({
      size: "kilo", hero: roomImg(rt) || undefined,
      title: rt.name, sub: `พักได้ ${rt.capacity || 2} ท่าน · ว่าง ${free} ห้อง`,
      lines: [
        kv("ราคา/คืน", money(rate.price)),
        kv(`รวม ${n} คืน`, money(rate.price * n), { weight: "bold", color: C.teal }),
        T(bfText(bf), { size: "xs", color: C.muted, margin: "sm" }),
        rt.extraBedPrice > 0 ? T(`🛏 เพิ่มเตียงเสริมได้ ${money(rt.extraBedPrice)}/คืน`, { size: "xs", color: C.muted, margin: "xs" }) : null,
        rt.description ? T(U.cut(rt.description, 90), { size: "xs", color: C.muted, margin: "sm" }) : null,
        short ? T(`⚠️ ช่วงนี้ต้องพักอย่างน้อย ${rate.minNights} คืน`, { size: "xs", color: C.amber, margin: "sm" }) : null,
      ],
      buttons: [short ? btn(pb(`📅 พัก ${rate.minNights} คืน`, `g=n&n=${rate.minNights}`, `พัก ${rate.minNights} คืน`), "secondary") : btn(pb("เลือกห้องนี้", `g=room&id=${rt._id}`, "เลือก " + rt.name))],
    });
  });
  ctx.say(text(`✨ ห้องว่าง ${thDate(d.din)} → ${thDate(d.dout)} (${n} คืน)\nเลื่อนดูแล้วกด “เลือกห้องนี้” ได้เลยค่ะ`),
    flex(`ห้องว่าง ${thDate(d.din)} → ${thDate(d.dout)}`, carousel(bubbles), [q("📅 เปลี่ยนวัน", "g=redate", "เปลี่ยนวัน"), qCancel()]));
}

async function pickRoom(ctx, d, id) {
  if (ctx.chat.step !== "room" || !d.din || !isId(id)) return stale(ctx);
  const rt = await RoomType.findOne({ _id: id, hotel: ctx.h._id, hidden: { $ne: true } }).lean();
  if (!rt) return stale(ctx);
  Object.assign(d, { rt: String(rt._id), rtName: rt.name, cap: Math.max(1, rt.capacity || 2), ebP: Math.max(0, Number(rt.extraBedPrice) || 0), bfMode: breakfastOf(rt).mode, bfPrice: breakfastOf(rt).price, eb: 0, addons: {} });
  const max = paxMax(d), n = Math.min(max, 10);
  return ask(ctx, "pax", d, text(`👥 “${rt.name}” เข้าพักกี่ท่านคะ? (ห้องนี้พักได้ ${d.cap} ท่าน${d.ebP ? ` · เพิ่มเตียงเสริมได้ถึง ${max} ท่าน` : ""})`,
    Array.from({ length: n }, (_, i) => q(`${i + 1} ท่าน`, `g=pax&n=${i + 1}`, `${i + 1} ท่าน`)).concat(qCancel())));
}
// เตียงเสริมได้สูงสุด 2 เตียงต่อห้อง (เท่าหน้าเว็บ) — 1 เตียง = 1 ท่าน
const EB_MAX = 2;
const paxMax = (d) => (d.cap || 2) + (d.ebP ? EB_MAX : 0);
function setPax(ctx, d, v) {
  if (ctx.chat.step !== "pax" || !d.rt) return stale(ctx);
  const n = parseInt(v, 10);
  if (!(n >= 1 && n <= paxMax(d))) return ctx.say(text(`พิมพ์จำนวน 1–${paxMax(d)} ท่านนะคะ`, [qCancel()]));
  d.pax = n;
  if (d.ebP) {
    const min = Math.max(0, n - (d.cap || 2));
    return ask(ctx, "eb", d, text(`🛏 เพิ่มเตียงเสริมไหมคะ? ${money(d.ebP)} / เตียง / คืน${min ? `\nเข้าพัก ${n} ท่าน ต้องเพิ่มอย่างน้อย ${min} เตียงค่ะ` : ""}`,
      Array.from({ length: EB_MAX - min + 1 }, (_, i) => i + min).map((k) => q(k ? `${k} เตียง` : "ไม่ต้องการ", `g=eb&n=${k}`, k ? `เตียงเสริม ${k} เตียง` : "ไม่เพิ่มเตียงเสริม")).concat(qCancel())));
  }
  d.eb = 0;
  return askBf(ctx, d);
}
function setEb(ctx, d, v) {
  if (ctx.chat.step !== "eb" || !d.rt) return stale(ctx);
  const k = parseInt(v, 10), min = Math.max(0, (d.pax || 1) - (d.cap || 2));
  if (!(k >= min && k <= EB_MAX)) return ctx.say(text(`เลือกเตียงเสริม ${min}–${EB_MAX} เตียงนะคะ`, [qCancel()]));
  d.eb = k;
  return askBf(ctx, d);
}
function askBf(ctx, d) {
  if (d.bfMode === "optional") {
    return ask(ctx, "bf", d, text(`🍳 เพิ่มอาหารเช้าไหมคะ?\n${money(d.bfPrice)} / ท่าน / คืน`, [
      q("เพิ่มอาหารเช้า", "g=bf&v=1", "เพิ่มอาหารเช้า"), q("ไม่เอา", "g=bf&v=0", "ไม่เอาอาหารเช้า"), qCancel()]));
  }
  d.bf = false;
  return askAddons(ctx, d, true);
}

// ---------- บริการเสริม/กิจกรรมที่ซื้อพ่วงได้ (ราคาและการกรองเหมือนหน้าเว็บ — ตรวจซ้ำอีกครั้งใน createRoomBooking)
const addonList = (h) => Service.find({ hotel: h._id, hidden: { $ne: true } }).sort("sort").lean().then((l) => l.filter((s) => sellsAddon(s) && s.price > 0));
const svcImg = (s) => https(s.imageUrl) || (B() && s.imageUrl ? `${B()}/api/public/img/svc/${s._id}/0?w=line&v=${new Date(s.updatedAt || 0).getTime()}` : "");
async function askAddons(ctx, d, showCards = false) {
  const list = await addonList(ctx.h);
  if (!list.length) return askName(ctx, d);
  d.addons = d.addons || {};
  const picked = list.filter((s) => d.addons[s._id]);
  const sum = picked.reduce((t, s) => t + s.price * d.addons[s._id], 0);
  const msgs = [];
  if (showCards) {
    msgs.push(text("✨ บริการเสริม / กิจกรรม (ไม่บังคับ)\nกด “➕ เพิ่ม” ที่รายการที่สนใจ หรือกด “ต่อไป” ถ้าไม่ต้องการค่ะ"));
    msgs.push(flex("บริการเสริม", carousel(list.slice(0, 10).map((s) => bubble({
      size: "kilo", hero: svcImg(s) || undefined, title: s.name, sub: `${money(s.price)} ${s.unit || ""}`.trim(),
      lines: [s.description ? T(U.cut(s.description, 90), { size: "xs", color: C.muted, margin: "sm" }) : null],
      buttons: [btn(pb("➕ เพิ่ม", `g=ad&id=${s._id}`, "เพิ่ม " + s.name), "secondary")],
    })))));
  }
  const head = picked.length ? `เลือกไว้:\n${picked.map((s) => `• ${s.name} × ${d.addons[s._id]} = ${money(s.price * d.addons[s._id])}`).join("\n")}\nรวมบริการเสริม ${money(sum)}` : "ยังไม่ได้เลือกบริการเสริม";
  const quick = [q(picked.length ? "✅ ต่อไป" : "ไม่ต้องการ · ต่อไป", "g=adok", "ต่อไป"), showCards ? null : q("✨ ดูบริการทั้งหมด", "g=adlist", "ดูบริการเสริม"), picked.length ? q("🗑 ล้างที่เลือก", "g=adclr", "ล้างบริการเสริม") : null, qCancel()];
  msgs.push(text(head, quick));
  return ask(ctx, "addon", d, ...msgs);
}
async function pickAddon(ctx, d, id) {
  if (!["addon", "adqty"].includes(ctx.chat.step) || !isId(id)) return stale(ctx);
  const s = (await addonList(ctx.h)).find((x) => String(x._id) === String(id));
  if (!s) return ctx.say(text("บริการนี้ปิดขายแล้วค่ะ", [q("✨ ดูบริการทั้งหมด", "g=adlist", "ดูบริการเสริม"), q("ต่อไป", "g=adok", "ต่อไป")]));
  d.adPick = String(s._id);
  const n = Math.min(10, Math.max(4, d.pax || 1));
  return ask(ctx, "adqty", d, text(`“${s.name}” ${money(s.price)} ${s.unit || ""}\nเอากี่${/ท่าน|คน/.test(s.unit || "") ? "ท่าน" : "ครั้ง"}คะ?`,
    Array.from({ length: n }, (_, i) => q(String(i + 1), `g=adq&n=${i + 1}`, String(i + 1))).concat(d.addons && d.addons[s._id] ? q("ไม่เอาแล้ว", "g=adq&n=0", "ไม่เอารายการนี้") : null, qCancel())));
}
function setAddonQty(ctx, d, v) {
  if (ctx.chat.step !== "adqty" || !d.adPick) return stale(ctx);
  const k = parseInt(v, 10);
  if (!(k >= 0 && k <= 50)) return ctx.say(text("พิมพ์จำนวน 1–50 นะคะ", [qCancel()]));
  d.addons = { ...(d.addons || {}) };
  if (k) d.addons[d.adPick] = k; else delete d.addons[d.adPick];
  delete d.adPick;
  return askAddons(ctx, d);
}
function askName(ctx, d) {
  return ask(ctx, "name", d, text("👤 ชื่อ-นามสกุลผู้เข้าพักค่ะ", [ctx.chat.name ? q("ใช้ " + fit(ctx.chat.name, 14), "g=nm", "ใช้ชื่อ " + ctx.chat.name) : null, qCancel()]));
}
function askTel(ctx, d) {
  return ask(ctx, "tel", d, text("📞 เบอร์โทรที่ติดต่อได้ค่ะ (เช่น 0812345678)", [qCancel()]));
}
function askPay(ctx, d) {
  const m = payMethodsOf(ctx.h);
  const opts = [m.promptpay ? ["promptpay", "📱 พร้อมเพย์"] : null, m.transfer ? ["transfer", "🏦 โอนเข้าบัญชี"] : null, m.onsite ? ["onsite", "💵 จ่ายที่ที่พัก"] : null].filter(Boolean);
  if (opts.length === 1) return setPay(ctx, d, opts[0][0], true);
  return ask(ctx, "pay", d, text("💳 ชำระเงินแบบไหนคะ?", opts.map(([k, l]) => q(l, "g=pay&v=" + k, l)).concat(qCancel())));
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
  switch (ctx.chat.step) {
    case "din": { const iso = parseDate(t); return iso ? setDin(ctx, iso) : ctx.say(text("อ่านวันที่ไม่ออก ลองพิมพ์ เช่น 25/10 หรือ 25 ต.ค. นะคะ", [qCancel()])); }
    case "dout": {
      const nn = /^(\d{1,2})\s*(คืน)?$/.exec(t);
      if (nn) return setDout(ctx, d, addDays(d.din, Math.max(1, +nn[1])));
      const iso = parseDate(t);
      return iso ? setDout(ctx, d, iso) : ctx.say(text("พิมพ์จำนวนคืน (เช่น 2) หรือวันเช็คเอาท์ (เช่น 27/10) นะคะ", [qCancel()]));
    }
    case "pax": return setPax(ctx, d, (/\d+/.exec(t) || [""])[0]);
    case "eb": return setEb(ctx, d, /^(ไม่|no)/i.test(t) ? 0 : (/\d+/.exec(t) || [""])[0]);
    case "adqty": return setAddonQty(ctx, d, (/\d+/.exec(t) || [""])[0]);
    case "addon": if (/^(ไม่|ต่อไป|ข้าม|เสร็จ|no|next|skip|ok)/i.test(t)) return askName(ctx, d); break;
    case "name": {
      const nm = t.replace(/\s+/g, " ").trim();
      if (nm.length < 2 || nm.length > 80) return ctx.say(text("พิมพ์ชื่อผู้เข้าพัก 2–80 ตัวอักษรนะคะ", [qCancel()]));
      d.name = nm; return askTel(ctx, d);
    }
    case "tel": {
      const ph = normPhone(t);
      if (!ph) return ctx.say(text("เบอร์โทรไม่ถูกต้องค่ะ ลองใหม่ เช่น 0812345678", [qCancel()]));
      d.tel = ph; return askPay(ctx, d);
    }
  }
  return ctx.say(text("กดเลือกจากปุ่มด้านล่างได้เลยค่ะ หรือพิมพ์ “ยกเลิก” เพื่อเริ่มใหม่", [qCancel()]));
}

// ================================================================ ยืนยัน + สร้างการจอง
const PAY_LABEL = { promptpay: "พร้อมเพย์ (สแกน QR)", transfer: "โอนเข้าบัญชีธนาคาร", onsite: "จ่ายที่ที่พักตอนเช็คอิน" };
async function showConfirm(ctx, d) {
  const rt = await RoomType.findOne({ _id: d.rt, hotel: ctx.h._id }).lean();
  if (!rt) return stale(ctx);
  const n = nightsOf(d.din, d.dout), rate = rateFor(rt, d.din);
  const bfTotal = d.bf ? d.bfPrice * d.pax * n : 0;
  const eb = d.eb || 0, ebP = Math.max(0, Number(rt.extraBedPrice) || 0), ebTotal = eb * ebP * n;
  const svcs = Object.keys(d.addons || {}).length ? (await addonList(ctx.h)).filter((s) => d.addons[s._id]) : [];
  const adTotal = svcs.reduce((t, s) => t + s.price * d.addons[s._id], 0);
  const total = rate.price * n + ebTotal + bfTotal + adTotal;
  await ask(ctx, "confirm", d, flex("ตรวจรายละเอียดก่อนยืนยันการจอง", bubble({
    tag: "ตรวจก่อนยืนยัน ✍️", title: d.rtName, sub: `${thDate(d.din)} → ${thDate(d.dout)} · ${n} คืน · ${d.pax} ท่าน`,
    lines: [
      kv("ผู้เข้าพัก", d.name), kv("เบอร์โทร", d.tel),
      kv(`ห้อง ${n} คืน`, money(rate.price * n)),
      eb ? kv(`เตียงเสริม ${eb} × ${n} คืน`, money(ebTotal)) : null,
      d.bfMode === "included" ? kv("อาหารเช้า", "รวมแล้ว") : d.bf ? kv(`อาหารเช้า ${d.pax} ท่าน`, money(bfTotal)) : null,
      ...svcs.map((s) => kv(`✨ ${s.name} × ${d.addons[s._id]}`, money(s.price * d.addons[s._id]))),
      sep(),
      kv("ยอดรวม", money(total), { weight: "bold", color: C.teal, size: "md" }),
      kv("ชำระ", PAY_LABEL[d.pay]),
    ],
    buttons: [
      btn(pb("✅ ยืนยันการจอง", "g=ok", "ยืนยันการจอง")),
      btn(pb("📅 เปลี่ยนวัน/ห้อง", "g=redate", "เปลี่ยนวัน"), "secondary"),
      btn(pb("ยกเลิก", "g=x", "ยกเลิก"), "link"),
    ],
  })));
}

async function confirmBooking(ctx) {
  // กันกดยืนยันซ้ำ: เปลี่ยน step เป็น saving แบบ atomic ก่อน
  const claimed = await GuestChat.findOneAndUpdate({ _id: ctx.chat._id, flow: "bk", step: "confirm" }, { $set: { step: "saving" } }).lean();
  if (!claimed) return stale(ctx);
  const d = claimed.data || {}, h = ctx.h, today = todayTH();
  const open = await Booking.countDocuments({ hotel: h._id, lineUserId: ctx.uid, status: { $ne: "cancelled" }, payStatus: "unpaid", checkout: { $gte: today } });
  if (open >= MAX_OPEN) {
    await clearFlow(ctx);
    return ctx.say(text(`คุณมีการจองที่ยังไม่ชำระ ${open} รายการแล้วค่ะ\nชำระหรือรอทีมงานที่พักติดต่อก่อน แล้วค่อยจองเพิ่มนะคะ`, [qMine()]));
  }
  const out = await createRoomBooking(h, {
    roomTypeId: d.rt, din: d.din, dout: d.dout, name: d.name, tel: d.tel, pax: d.pax,
    payMethod: d.pay, paid: false, breakfast: !!d.bf, breakfastPax: d.pax, note: "จองผ่านแชท LINE",
    extraBed: d.eb || 0, addons: Object.entries(d.addons || {}).map(([serviceId, qty]) => ({ serviceId, qty })),
  }, { lineUserId: ctx.uid });
  if (out.status !== 200) {
    await setFlow(ctx, "room", { din: d.din, dout: d.dout });
    return ctx.say(text("😢 จองไม่สำเร็จ: " + (out.body.error || "ลองใหม่อีกครั้ง"), [q("📅 เลือกวัน/ห้องใหม่", "g=redate", "เปลี่ยนวัน"), qCancel()]));
  }
  await clearFlow(ctx);
  const r = out.body;
  ctx.say(flex(`จองแล้ว ${r.ref} · ${money(r.amount)}`, bubble({
    tag: `🎉 จองแล้ว · ${r.ref}`, tagColor: C.sage, title: r.roomName, sub: `${thDate(r.checkin)} → ${thDate(r.checkout)} · ${r.nights} คืน`,
    lines: [
      kv("ผู้เข้าพัก", d.name), kv("ยอดรวม", money(r.amount), { weight: "bold" }),
      kv("สถานะ", r.payStatus === "onsite" ? "จ่ายที่ที่พักตอนเช็คอิน" : "รอชำระเงิน"),
      T("เก็บเลขจองไว้ใช้ตอนเช็คอินนะคะ", { size: "xs", color: C.muted, margin: "md" }),
    ],
  })));
  if (r.payStatus === "onsite") return ctx.say(text(`✅ เรียบร้อยค่ะ ชำระ ${money(r.amount)} ที่ที่พักตอนเช็คอินได้เลย\nแล้วพบกันนะคะ 🌿`, [qMine()]));
  payInstructions(ctx, r.payMethod, r.amount, r.holdUntil, r.ref);
}

function payInstructions(ctx, method, amount, holdUntil, ref) {
  const h = ctx.h, m = payMethodsOf(h);
  const due = holdUntil ? `\n⏰ กรุณาชำระภายใน ${thWhen(holdUntil)} ไม่งั้นระบบจะปล่อยห้องอัตโนมัติ` : "";
  const quick = [qRoll("🖼 ส่งสลิป"), qCam("📷 ถ่ายสลิป"), q("โอนแล้ว", "g=paid&ref=" + encodeURIComponent(ref || ""), "โอนแล้ว"), qMine()];
  if (method === "promptpay" && m.promptpay) {
    const qr = B() ? `${B()}/api/public/promptpay-qr?slug=${encodeURIComponent(h.slug)}&amount=${amount}` : "";
    if (qr) ctx.say({ type: "image", originalContentUrl: qr, previewImageUrl: qr });
    return ctx.say(text(`📱 สแกน QR พร้อมเพย์ด้านบน ยอด ${money(amount)}${qr ? "" : `\nพร้อมเพย์: ${formatPromptPayId(h.promptpayId)}`}${due}\n\nโอนแล้วส่งรูปสลิปในแชทนี้ได้เลยค่ะ 🙏`, quick));
  }
  const bank = m.bank;
  if (bank) return ctx.say(text(`🏦 โอนเข้าบัญชี ยอด ${money(amount)}\nธนาคาร${bank.name}\nเลขที่ ${bank.noFmt}\nชื่อบัญชี ${bank.acct}${due}\n\nโอนแล้วส่งรูปสลิปในแชทนี้ได้เลยค่ะ 🙏`, quick));
  return ctx.say(text(`ทีมงานที่พักจะติดต่อเรื่องการชำระเงิน ยอด ${money(amount)} นะคะ`, [qMine()]));
}

// ================================================================ แจ้งโอน (ส่งรูปสลิป / กด "โอนแล้ว")
// สลิปอยู่ในแชท OA ของโรงแรมให้ทีมดูได้เลย — ระบบแค่เปลี่ยนสถานะเป็น "แจ้งโอนแล้ว" แล้วแจ้งที่พัก
async function onSlip(ctx, how) {
  const today = todayTH();
  const b = await Booking.findOne({ hotel: ctx.h._id, lineUserId: ctx.uid, status: { $ne: "cancelled" }, payStatus: "unpaid", checkout: { $gte: today } }).sort({ createdAt: -1 }).lean();
  if (!b) {
    if (how === "slip") return; // รูปทั่วไป (ไม่มีการจองรอชำระ) — ปล่อยให้ทีมที่พักดูเอง
    return ctx.say(text("ไม่พบการจองที่รอชำระค่ะ", [qMine(), qStart()]));
  }
  const g = /^(BP-[A-Z0-9]{6})/.exec(String(b.ref || ""));
  const filter = g ? { hotel: ctx.h._id, ref: new RegExp("^" + g[1] + "(-\\d+)?$"), status: { $ne: "cancelled" }, payStatus: "unpaid" } : { _id: b._id };
  await Booking.updateMany(filter, { $set: { payStatus: "reported", payRef: how === "slip" ? "ส่งสลิปในแชท LINE OA" : "แจ้งโอนในแชท LINE OA (ยังไม่ส่งสลิป)" } });
  notifyPaidReport("room", b._id).catch((e) => console.error("notifyPaidReport", e.message));
  ctx.say(text(`📩 ได้รับ${how === "slip" ? "สลิป" : "แจ้งโอน"}แล้วค่ะ (${(g && g[1]) || b.ref})\nทีมงานกำลังตรวจยอด ยืนยันแล้วจะแจ้งในแชทนี้นะคะ 🙏${how === "slip" ? "" : "\n\nถ้ามีสลิป ส่งรูปมาในแชทนี้ได้เลยค่ะ"}`, [qMine()]));
}

// ================================================================ การจองของฉัน
const PAY_TH = { unpaid: "⏳ รอชำระ", reported: "💸 แจ้งโอนแล้ว รอตรวจ", paid: "✅ ชำระแล้ว", onsite: "🤝 จ่ายที่ที่พัก", "": "—" };
async function myBookings(ctx) {
  const list = await Booking.find({ hotel: ctx.h._id, lineUserId: ctx.uid, status: { $ne: "cancelled" }, checkout: { $gte: todayTH() } }).sort({ checkin: 1 }).limit(20).lean();
  const main = list.filter((b) => !/-\d+$/.test(String(b.ref || "")));
  if (!main.length) return ctx.say(text("ยังไม่มีการจองที่กำลังจะมาถึงค่ะ\n(การจองที่ทำบนหน้าเว็บ เช็กได้ที่หน้าจอง ด้วยเลขจอง + เบอร์โทร)", [qStart()]));
  const rooms = await RoomType.find({ _id: { $in: main.map((b) => b.roomType).filter(Boolean) } }).select("name").lean();
  const rn = Object.fromEntries(rooms.map((r) => [String(r._id), r.name]));
  const body = main.slice(0, 8).map((b) => `• ${b.ref} — ${rn[String(b.roomType)] || "ห้องพัก"}\n   ${thDate(b.checkin)} → ${thDate(b.checkout)} · ${money(b.amount)}\n   ${PAY_TH[b.payStatus || ""] || b.payStatus}`).join("\n\n");
  const unpaid = main.find((b) => b.payStatus === "unpaid");
  if (unpaid) {
    ctx.say(text(`📋 การจองของคุณ\n\n${body}`));
    return payInstructions(ctx, unpaid.payMethod, list.filter((b) => String(b.ref || "").startsWith(unpaid.ref)).reduce((s, b) => s + (b.amount || 0), 0), null, unpaid.ref);
  }
  ctx.say(text(`📋 การจองของคุณ\n\n${body}${ctx.h.phone ? `\n\nติดต่อที่พัก โทร ${ctx.h.phone}` : ""}`, [qStart()]));
}
