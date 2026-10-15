import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Booking from "../models/Booking.js";
import ActivityBooking from "../models/ActivityBooking.js";
import LineChat from "../models/LineChat.js";
import * as L from "./line.js";
import * as U from "./lineui.js";
import { baseUrl } from "./baseurl.js";
import { stayInfo, lineContactUrl, lineLabel } from "./stay.js";
import { normalizePromptPayId, formatPromptPayId } from "./promptpay.js";
import { payMethodsOf, methodTh } from "./pay.js";

// แจ้งแขกทางอีเมล (Brevo) เท่านั้น — ไม่มี SMS (มีค่าใช้จ่ายต่อข้อความ) · แขกทักแชทที่พักผ่านปุ่ม LINE บนหน้าจองได้
const BREVO        = process.env.BREVO_API_KEY || "";
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "noreply@barnpark.co";
const SENDER_NAME  = process.env.BREVO_SENDER_NAME || "BARN-PARK";
const LINE_FALLBACK = process.env.LINE_CHANNEL_TOKEN || ""; // OA กลาง (ถ้ามี) — ปกติใช้ token ต่อโรงแรม

const money = (n) => "฿" + Number(n || 0).toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const guest = (n) => esc(String(n || "").trim().replace(/^คุณ\s*/, "")); // "สวัสดีคุณ ..." ไม่ให้ซ้ำ "คุณคุณ"
const pad = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------- วันที่แบบไทย
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_D = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const ymdDate = (ymd) => new Date(String(ymd) + "T00:00:00Z");
export const thDay = (ymd) => { const d = ymdDate(ymd); return isNaN(d) ? String(ymd || "") : `${TH_D[d.getUTCDay()]} ${d.getUTCDate()} ${TH_M[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`; };
const thShort = (ymd) => { const d = ymdDate(ymd); return isNaN(d) ? String(ymd || "") : `${TH_D[d.getUTCDay()]} ${d.getUTCDate()} ${TH_M[d.getUTCMonth()]}`; };
const thWhen = (date) => { const d = new Date(new Date(date).getTime() + 7 * 3600e3); return `${d.getUTCDate()} ${TH_M[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} น.`; };
export const nightsOf = (a, b) => Math.max(1, Math.round((ymdDate(b) - ymdDate(a)) / 864e5));
const telUri = (t) => { const d = String(t || "").replace(/[^\d+]/g, ""); return d.length >= 9 ? "tel:" + d : ""; };
export const lineAddUrl = lineContactUrl; // ชื่อเดิม (ลิงก์ LINE ของที่พักให้แขกทักแชท)
const PAY_TH = { paid: "ชำระแล้ว ✅", reported: "แจ้งโอนแล้ว · รอที่พักตรวจสอบ", deposit: "ชำระมัดจำแล้ว", onsite: "จ่ายที่เคาน์เตอร์ตอนเช็คอิน", unpaid: "ยังไม่ชำระ" };
// สถานะ + ช่องทาง เช่น "แจ้งโอนแล้ว · รอที่พักตรวจสอบ (พร้อมเพย์)"
const payTh = (s, m) => (PAY_TH[s] || "—") + (m && s !== "onsite" && methodTh(m) ? ` (${methodTh(m)})` : "");
// ติดต่อที่พัก (อีเมล): โทร · LINE (เป็นลิงก์กดทักแชทได้)
const contactHtml = (h) => [h.phone ? `โทร ${esc(h.phone)}` : "", lineContactUrl(h.lineId) ? `<a href="${esc(lineContactUrl(h.lineId))}" style="color:#06C755;font-weight:700">LINE ${esc(lineLabel(h.lineId) === "LINE" ? "ที่พัก" : lineLabel(h.lineId))}</a>` : ""].filter(Boolean).join(" · ");
const contactText = (h) => [h.phone ? `โทร ${h.phone}` : "", lineLabel(h.lineId) ? `LINE ${lineLabel(h.lineId) === "LINE" ? lineContactUrl(h.lineId) : lineLabel(h.lineId)}` : ""].filter(Boolean).join(" · ");
export { contactText };
// เวลาที่ระบบจะปล่อยห้องถ้ายังไม่จ่าย (ตาม holdHours ของโรงแรม)
// ระบบปล่อยเฉพาะการจองที่ยังไม่ถึงวันเช็คอิน — ถ้าครบเวลาตรงกับ/หลังวันเช็คอิน จะไม่ยกเลิกเอง (แขกจ่ายตอนมาถึง) → คืน null
export function holdDeadline(h, b) {
  if (!(b.payStatus === "unpaid" && (b.channel || "direct") === "direct" && Number(h.holdHours) > 0 && b.createdAt)) return null;
  const dl = new Date(new Date(b.createdAt).getTime() + Number(h.holdHours) * 3600e3);
  const dlDay = new Date(dl.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
  return dlDay < String(b.checkin || "") ? dl : null;
}

// ---------------------------------------------------------------- สรุปการจอง (รวมทุกห้องในเลขจองเดียวกัน)
export async function bookingGroup(b) {
  const g = /^(BP-[A-Z0-9]{6})(-\d+)?$/.exec(String(b.ref || ""));
  if (!g) return [b];
  const list = await Booking.find({ hotel: b.hotel, ref: new RegExp("^" + g[1] + "(-\\d+)?$") }).lean();
  return list.length ? list.sort((x, y) => String(x.ref).length - String(y.ref).length || String(x.ref).localeCompare(String(y.ref))) : [b];
}
export function summarize(list, rt) {
  const first = list[0];
  const live = list.filter((x) => x.status !== "cancelled");
  const use = live.length ? live : list;
  return {
    ref: String(first.ref || "").replace(/-\d+$/, ""), rooms: use.length, roomName: (rt && rt.name) || "ห้องพัก",
    checkin: first.checkin, checkout: first.checkout, nights: nightsOf(first.checkin, first.checkout),
    pax: first.pax || 0, extraBed: first.extraBed || 0, amount: use.reduce((t, x) => t + (Number(x.amount) || 0), 0),
    discount: use.reduce((t, x) => t + (Number(x.discount) || 0), 0), promoCode: first.promoCode || "",
    addons: first.addons || [], addonTotal: first.addonTotal || 0,
    breakfast: first.breakfast || "", breakfastPax: first.breakfastPax || 0, breakfastTotal: first.breakfastTotal || 0,
    payStatus: first.payStatus || "", payMethod: first.payMethod || "", payRef: first.payRef || "", note: first.note || "",
    guestName: first.guestName || "", guestTel: first.guestTel || "", guestEmail: first.guestEmail || "",
    channel: first.channel || "direct", createdAt: first.createdAt, id: String(first._id), status: first.status,
  };
}
const bfLine = (s) => s.breakfast === "included" ? "รวมอาหารเช้าแล้ว" : s.breakfast === "added" ? `เพิ่ม ${s.breakfastPax} ท่าน × ${s.nights} คืน (${money(s.breakfastTotal)})` : "";
const addonLine = (s) => (s.addons || []).map((a) => `${a.name} ×${a.qty}`).join(", ");

// ---------------------------------------------------------------- อีเมลยืนยันการจอง (แขก / โรงแรม)
export function bookingEmailHtml(h, s, { forHotel = false, reminder = false } = {}) {
  const st = stayInfo(h);
  const B = baseUrl();
  const pm = payMethodsOf(h);
  const unpaid = s.payStatus === "unpaid";
  const dl = holdDeadline(h, s);
  // ยังไม่จ่าย → บอกวิธีโอนตามช่องทางที่แขกเลือก (หรือช่องทางที่ที่พักเปิดไว้)
  const useBank = unpaid && pm.transfer && (s.payMethod === "transfer" || !pm.promptpay);
  const pp = unpaid && !useBank && pm.promptpay ? normalizePromptPayId(h.promptpayId) : "";
  const qr = pp && B ? `${B}/api/public/promptpay-qr?slug=${encodeURIComponent(h.slug)}&amount=${Number(s.amount).toFixed(2)}` : "";
  const bookLink = B && h.slug ? `${B}/book.html?h=${encodeURIComponent(h.slug)}` : "";
  const dlNote = dl ? `\n<b style="color:#b45309">กรุณาชำระภายใน ${thWhen(dl)} มิฉะนั้นระบบจะยกเลิกการจองอัตโนมัติ</b>` : "";
  const reportNote = !forHotel && bookLink ? `\nโอนแล้วแจ้งได้ที่ <a href="${bookLink}&find=1" style="color:#0d9488">หน้าจอง → เช็กการจอง</a> (ใช้เลขจอง + เบอร์โทร)` : "";
  const row = (k, v) => v ? `<tr><td style="color:#5b7089;padding:7px 0;vertical-align:top;width:38%">${k}</td><td style="text-align:right;padding:7px 0">${v}</td></tr>` : "";
  const box = (title, body) => `<div style="background:#f6f8fb;border-radius:10px;padding:12px 14px;margin:12px 0"><div style="font-weight:700;margin-bottom:4px">${title}</div><div style="font-size:13.5px;color:#334155;white-space:pre-line">${body}</div></div>`;
  const cin = thDay(s.checkin) + (st.checkInTime ? ` · ตั้งแต่ ${st.checkInTime} น.` : "");
  const cout = thDay(s.checkout) + (st.checkOutTime ? ` · ก่อน ${st.checkOutTime} น.` : "");
  const contact = contactHtml(h);
  return `
  <div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;max-width:540px;margin:auto;color:#0f2540;line-height:1.5">
    <h2 style="color:#0d9488;margin:0 0 6px">${forHotel ? "🆕 การจองใหม่" : reminder ? "พรุ่งนี้เช็คอินแล้ว 🧳" : "ยืนยันการจอง"} — ${esc(h.name) || "ที่พัก"}</h2>
    <p style="margin:0 0 12px">${forHotel ? `แขก: <b>${esc(s.guestName)}</b> · ${esc(s.guestTel)}${s.guestEmail ? " · " + esc(s.guestEmail) : ""}` : reminder ? `สวัสดีคุณ${guest(s.guestName)} ที่พักเตรียมห้องรอแล้ว — ข้อมูลการเดินทางและการเข้าพักอยู่ด้านล่าง 👇` : `สวัสดีคุณ${guest(s.guestName)} ขอบคุณที่จองตรงกับเรา 🙏`}</p>
    <div style="text-align:center;background:#ecfdf5;border-radius:12px;padding:12px;margin:0 0 10px">
      <div style="font-size:12px;color:#047857">หมายเลขการจอง</div><div style="font-size:24px;font-weight:800;letter-spacing:2px">${esc(s.ref)}</div></div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${row("ห้อง", `${esc(s.roomName)}${s.rooms > 1 ? ` × ${s.rooms} ห้อง` : ""}`)}
      ${row("เช็คอิน", cin)}
      ${row("เช็คเอาท์", `${cout}<br><span style="color:#5b7089">${s.nights} คืน${s.pax ? ` · ${s.pax} ท่าน` : ""}</span>`)}
      ${row("อาหารเช้า", esc(bfLine(s)))}
      ${row("บริการเสริม", esc(addonLine(s)))}
      ${row("ส่วนลด", s.discount ? "-" + money(s.discount) + (s.promoCode ? ` (${esc(s.promoCode)})` : "") : "")}
      ${row("ยอดรวม", `<b style="font-size:16px">${money(s.amount)}</b>`)}
      ${row("การชำระเงิน", payTh(s.payStatus, s.payMethod) + (s.payRef ? `<br><span style="color:#5b7089">อ้างอิง ${esc(s.payRef)}</span>` : ""))}
    </table>
    ${s.note ? box("📝 คำขอพิเศษ", esc(s.note)) : ""}
    ${pp ? box("📱 ชำระผ่านพร้อมเพย์", `${esc(h.promptpayName || h.name)} · ${formatPromptPayId(pp)}\nยอด ${money(s.amount)}${dlNote}${reportNote}`)
      + (qr && !forHotel ? `<div style="text-align:center"><img src="${qr}" alt="PromptPay QR" width="200" height="200" style="width:200px;height:200px"></div>` : "") : ""}
    ${useBank ? box("🏦 โอนเข้าบัญชีธนาคาร", `ธนาคาร${esc(pm.bank.name)}\nเลขบัญชี <b style="font-size:16px;letter-spacing:1px">${esc(pm.bank.noFmt)}</b>\nชื่อบัญชี ${esc(pm.bank.acct)}\nยอด ${money(s.amount)}${dlNote}${reportNote}`) : ""}
    ${s.payStatus === "onsite" && !forHotel ? box("💵 ชำระที่เคาน์เตอร์", `ชำระ ${money(s.amount)} ตอนเช็คอินที่ที่พัก`) : ""}
    ${(st.address || st.mapUrl) ? box("📍 ที่ตั้ง", `${esc(st.address || h.location || "")}${st.mapUrl ? `\n<a href="${esc(st.mapUrl)}" style="color:#0d9488;font-weight:700">เปิดแผนที่ Google Maps →</a>` : ""}`) : ""}
    ${st.houseRules ? box("📜 กฎที่พัก / ข้อควรรู้", esc(st.houseRules)) : ""}
    <p style="color:#5b7089;font-size:13px;margin:10px 0 4px">${h.allowGuestCancel !== false ? `ยกเลิกฟรีก่อนเช็คอินอย่างน้อย ${h.cancelDays ?? 3} วัน${bookLink ? ` — <a href="${bookLink}" style="color:#0d9488">ยกเลิก/รีวิวได้ที่หน้าจอง</a>` : ""}` : "หากต้องการยกเลิก กรุณาติดต่อที่พักโดยตรง"}</p>
    ${!forHotel && contact ? `<p style="color:#5b7089;font-size:13px;margin:0">ติดต่อที่พัก: ${contact}</p>` : ""}
    <p style="color:#94a3b8;font-size:12px;margin-top:14px">ส่งอัตโนมัติโดย BARN-PARK</p>
  </div>`;
}
// ข้อความสั้นยืนยันการจอง (ใช้ส่ง LINE ถ้าระบบรู้ LINE ของแขก)
const bookingText = (h, s) => {
  const st = stayInfo(h);
  return `ยืนยันจอง ${s.ref} ${h.name}\n${thShort(s.checkin)}${st.checkInTime ? " " + st.checkInTime : ""} - ${thShort(s.checkout)} (${s.nights} คืน)\nยอด ${money(s.amount)} ${payTh(s.payStatus, s.payMethod)}`;
};

// ---------------------------------------------------------------- การ์ด LINE แจ้งโรงแรม (ผ่าน LINE Barn Park)
export function bookingAlert(h, s, opts = {}) {
  const hh = "&hh=" + h._id;
  const reported = s.payStatus === "reported", unpaid = s.payStatus === "unpaid";
  const dl = holdDeadline(h, s);
  const tel = telUri(s.guestTel);
  const head = opts.report ? "💸 แขกแจ้งโอนแล้ว" : reported ? "💸 จองใหม่ · แขกแจ้งโอนแล้ว" : "🆕 จองใหม่";
  return U.flex(`${head} ${s.ref} · ${s.guestName} · ${money(s.amount)}`, U.bubble({
    tag: `${head} · ${s.ref}`, tagColor: reported ? U.C.amber : U.C.teal,
    title: s.guestName || "แขก", sub: `🛏 ${s.roomName}${s.rooms > 1 ? ` × ${s.rooms} ห้อง` : ""}${s.pax ? ` · ${s.pax} คน` : ""}${h.name ? ` · ${h.name}` : ""}`,
    lines: [
      U.kv("เข้าพัก", `${thShort(s.checkin)} → ${thShort(s.checkout)}`),
      U.kv("จำนวน", `${s.nights} คืน`),
      bfLine(s) ? U.kv("อาหารเช้า", bfLine(s)) : null,
      addonLine(s) ? U.kv("บริการเสริม", addonLine(s)) : null,
      U.kv("ยอดรวม", money(s.amount), { weight: "bold" }),
      U.kv("ชำระ", payTh(s.payStatus, s.payMethod) + (s.payRef ? ` · อ้างอิง ${s.payRef}` : "")),
      s.note ? U.T("📝 " + s.note, { size: "sm", color: U.C.navy, margin: "md", wrap: true }) : null,
      dl ? U.T(`⏱ ถ้ายังไม่ได้รับเงิน ระบบจะยกเลิกอัตโนมัติ ${thWhen(dl)} — กด “🤝 จ่ายที่เคาน์เตอร์” ถ้าตกลงเก็บเงินตอนเช็คอิน`, { size: "xs", color: U.C.amber, margin: "md", wrap: true }) : null,
    ],
    buttons: [
      reported || unpaid ? U.btn(U.pb(reported ? "✅ ยืนยันรับเงินแล้ว" : "✅ ได้รับเงินแล้ว", `a=bp&id=${s.id}${hh}`, "ยืนยันรับเงิน " + s.ref)) : null,
      unpaid ? U.btn(U.pb("🤝 จ่ายที่เคาน์เตอร์", `a=bo&id=${s.id}${hh}`, "ให้จ่ายที่เคาน์เตอร์ " + s.ref), "secondary") : null,
      tel ? U.btn(U.uri("📞 โทรหาแขก", tel), "secondary") : null,
      U.btn(U.pb("📅 การจองทั้งหมด", "a=bk" + hh, "การจอง"), "link"),
    ],
  }));
}
function activityAlert(h, b, opts = {}) {
  const hh = "&hh=" + h._id;
  const tel = telUri(b.guestTel);
  const reported = b.payStatus === "reported";
  const head = opts.report ? "💸 แขกแจ้งโอน · กิจกรรม" : `🎟 จองกิจกรรม${reported ? " · แจ้งโอนแล้ว" : ""}`;
  return U.flex(`${head} ${b.ref} · ${b.guestName} · ${money(b.amount)}`, U.bubble({
    tag: `${head} · ${b.ref}`, tagColor: reported ? U.C.amber : U.C.sage,
    title: b.guestName || "แขก", sub: `${b.serviceName} · ${b.qty} ท่าน`,
    lines: [
      U.kv("วัน", thShort(b.date) + (b.time ? " · " + b.time : "")),
      U.kv("ยอด", money(b.amount), { weight: "bold" }),
      U.kv("ชำระ", payTh(b.payStatus, b.payMethod) + (b.payRef ? ` · อ้างอิง ${b.payRef}` : "")),
      b.note ? U.T("📝 " + b.note, { size: "sm", margin: "md", wrap: true }) : null,
    ],
    buttons: [
      b.payStatus !== "paid" && b.amount > 0 ? U.btn(U.pb("✅ ได้รับเงินแล้ว", `a=bpa&id=${b._id}${hh}`, "ยืนยันรับเงิน " + b.ref)) : null,
      tel ? U.btn(U.uri("📞 โทรหาแขก", tel), "secondary") : null,
      U.btn(U.pb("📅 การจองทั้งหมด", "a=bk" + hh, "การจอง"), "link"),
    ],
  }));
}

// ส่งเข้า LINE Barn Park ของทุกคนที่เชื่อมที่พักนี้ (นับโควตา push: 1 ข้อความ/คน/ครั้ง)
export async function pushHotelChats(hotelId, messages) {
  if (!L.lineReady()) return 0;
  const chats = await LineChat.find({ hotels: hotelId }).select("userId").lean();
  let n = 0;
  for (const uid of [...new Set(chats.map((c) => c.userId).filter(Boolean))]) {
    try { await L.push(uid, messages); n++; }
    catch (e) { console.error("push hotel chat", e.message); if (/→ 429/.test(String(e.message))) quotaAlarm(); }
  }
  return n;
}
// โควตาข้อความ LINE OA เต็ม → แจ้งแอดมินทางอีเมล (ไม่เกินทุก 12 ชม.) เพราะแจ้งเตือนทาง LINE จะส่งไม่ออกจนกว่าจะอัปเกรด/ขึ้นเดือนใหม่
let lastQuotaMail = 0;
function quotaAlarm() {
  const to = process.env.ADMIN_NOTIFY_EMAIL || process.env.SEED_ADMIN_EMAIL || "";
  if (!BREVO || !to || Date.now() - lastQuotaMail < 12 * 3600e3) return;
  lastQuotaMail = Date.now();
  sendEmail(to, "⚠️ โควตาข้อความ LINE OA Barn Park เต็มแล้ว",
    `<div style="font-family:sans-serif;color:#0f2540"><h3>โควตาข้อความ (push) ของ LINE OA Barn Park เต็มแล้ว</h3>
     <p>แจ้งเตือนจองใหม่/แจ้งโอน/ยกเลิก ที่ส่งเข้า LINE ของโรงแรม จะส่งไม่ออกจนกว่าจะขึ้นเดือนใหม่หรืออัปเกรดแพ็กเกจ (อีเมลแจ้งเตือนยังส่งปกติ)</p>
     <p>อัปเกรดได้ที่ LINE Official Account Manager (manager.line.biz) → ตั้งค่า → แพ็กเกจ</p></div>`).catch((e) => console.error("quota mail", e.message));
}

// ---------------------------------------------------------------- จองห้องใหม่
// เรียกหลังสร้าง booking (fire-and-forget) — ส่งตามช่องที่แขกเลือก + แจ้งโรงแรม (LINE Barn Park / LINE OA ของโรงแรม / อีเมล)
export async function notifyBooking(bookingId) {
  const b = await Booking.findById(bookingId).lean();
  if (!b || b.status === "cancelled") return;
  const h = await Hotel.findById(b.hotel).select("+lineChannelToken").lean();
  if (!h) return;
  const t = b.roomType ? await RoomType.findById(b.roomType).select("name").lean() : null;
  const s = summarize(await bookingGroup(b), t);
  const want = (b.notifyChannel || "email").toLowerCase();
  const lineToken = h.lineChannelToken || LINE_FALLBACK; // ★ LINE OA ต่อโรงแรม
  const jobs = [];
  // แขก: อีเมลยืนยัน (ไม่มี SMS) — ไม่ได้ใส่อีเมล ก็ยังเห็นหน้ายืนยัน + เช็กการจองได้ที่หน้าจอง (เลขจอง + เบอร์)
  if (want !== "none") {
    if (BREVO && b.guestEmail) jobs.push(sendEmail(b.guestEmail, `ยืนยันการจอง ${s.ref} — ${h.name}`, bookingEmailHtml(h, s)));
    if (lineToken && b.lineUserId) jobs.push(pushLine(lineToken, b.lineUserId, bookingText(h, s)));
  }
  if (BREVO && h.notifyEmail) jobs.push(sendEmail(h.notifyEmail, `การจองใหม่ ${s.ref} — ${s.guestName}`, bookingEmailHtml(h, s, { forHotel: true })));
  // LINE OA ของโรงแรมเอง (ถ้าตั้งผู้รับไว้)
  if (lineToken && h.notifyLineTo) {
    jobs.push(pushLine(lineToken, h.notifyLineTo,
      `🆕 จองใหม่ ${s.ref}\nแขก: ${s.guestName || "-"} (${s.guestTel || "-"})\nห้อง: ${s.roomName}${s.rooms > 1 ? " × " + s.rooms : ""}\n` +
      `เข้าพัก: ${s.checkin} → ${s.checkout} (${s.nights} คืน)${bfLine(s) ? "\nอาหารเช้า: " + bfLine(s) : ""}${s.note ? "\nคำขอ: " + s.note : ""}\nยอด: ${money(s.amount)} · ${payTh(s.payStatus, s.payMethod)}`));
  }
  // ★ LINE Barn Park — การ์ดพร้อมปุ่มยืนยันรับเงิน
  jobs.push(pushHotelChats(h._id, [bookingAlert(h, s)]));
  await Promise.allSettled(jobs);
}

// ---------------------------------------------------------------- จองกิจกรรมเดี่ยว
export async function notifyActivity(id) {
  const b = await ActivityBooking.findById(id).lean();
  if (!b || b.status === "cancelled") return;
  const h = await Hotel.findById(b.hotel).select("+lineChannelToken").lean();
  if (!h) return;
  const st = stayInfo(h);
  const when = thDay(b.date) + (b.time ? " · " + b.time + " น." : "");
  const contact = contactHtml(h);
  // ยังไม่จ่าย → วิธีชำระตามช่องทางที่แขกเลือก · จ่ายที่เคาน์เตอร์ → บอกให้จ่ายวันใช้บริการ
  const pm = payMethodsOf(h), B = baseUrl();
  const unpaid = b.payStatus === "unpaid" && b.amount > 0;
  const useBank = unpaid && pm.transfer && (b.payMethod === "transfer" || !pm.promptpay);
  const ppId = unpaid && !useBank && pm.promptpay ? normalizePromptPayId(h.promptpayId) : "";
  const findLink = B && h.slug ? `${B}/book.html?h=${encodeURIComponent(h.slug)}&find=1` : "";
  const payBox = ppId ? `<div style="background:#f6f8fb;border-radius:10px;padding:12px 14px;margin:12px 0;font-size:13.5px"><b>📱 ชำระผ่านพร้อมเพย์</b><br>${esc(h.promptpayName || h.name)} · ${formatPromptPayId(ppId)} · ยอด ${money(b.amount)}${B ? `<div style="text-align:center"><img src="${B}/api/public/promptpay-qr?slug=${encodeURIComponent(h.slug)}&amount=${Number(b.amount).toFixed(2)}" alt="PromptPay QR" width="180" height="180"></div>` : ""}${findLink ? `โอนแล้วแจ้งได้ที่ <a href="${findLink}" style="color:#0d9488">เช็กการจอง</a>` : ""}</div>`
    : useBank ? `<div style="background:#f6f8fb;border-radius:10px;padding:12px 14px;margin:12px 0;font-size:13.5px"><b>🏦 โอนเข้าบัญชีธนาคาร</b><br>ธนาคาร${esc(pm.bank.name)} · <b>${esc(pm.bank.noFmt)}</b><br>ชื่อบัญชี ${esc(pm.bank.acct)} · ยอด ${money(b.amount)}${findLink ? `<br>โอนแล้วแจ้งได้ที่ <a href="${findLink}" style="color:#0d9488">เช็กการจอง</a>` : ""}</div>`
    : b.payStatus === "onsite" ? `<p style="font-size:13.5px">💵 ชำระ ${money(b.amount)} ที่เคาน์เตอร์ในวันใช้บริการ</p>` : "";
  const html = `
    <div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;max-width:540px;margin:auto;color:#0f2540;line-height:1.5">
      <h2 style="color:#0d9488;margin:0 0 8px">ยืนยันการจองกิจกรรม — ${esc(h.name) || "ที่พัก"}</h2>
      <p>สวัสดีคุณ${guest(b.guestName)} 🎉</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="color:#5b7089;padding:6px 0">หมายเลขการจอง</td><td style="text-align:right"><b>${esc(b.ref)}</b></td></tr>
        <tr><td style="color:#5b7089;padding:6px 0">กิจกรรม</td><td style="text-align:right">${esc(b.serviceName)}</td></tr>
        <tr><td style="color:#5b7089;padding:6px 0">วัน/เวลา</td><td style="text-align:right">${esc(when)}</td></tr>
        <tr><td style="color:#5b7089;padding:6px 0">จำนวน</td><td style="text-align:right">${b.qty} ท่าน</td></tr>
        <tr><td style="color:#5b7089;padding:6px 0">ยอดรวม</td><td style="text-align:right"><b>${money(b.amount)}</b></td></tr>
        <tr><td style="color:#5b7089;padding:6px 0">สถานะชำระเงิน</td><td style="text-align:right">${payTh(b.payStatus, b.payMethod)}</td></tr>
      </table>
      ${payBox}
      ${(st.address || st.mapUrl) ? `<p style="font-size:13.5px">📍 ${esc(st.address || h.location || "")}${st.mapUrl ? ` · <a href="${esc(st.mapUrl)}" style="color:#0d9488">เปิดแผนที่</a>` : ""}</p>` : ""}
      ${contact ? `<p style="color:#5b7089;font-size:13px">ติดต่อที่พัก: ${contact}</p>` : ""}
      <p style="color:#94a3b8;font-size:12px">ส่งอัตโนมัติโดย BARN-PARK</p>
    </div>`;
  const jobs = [];
  if (BREVO && b.guestEmail) jobs.push(sendEmail(b.guestEmail, `ยืนยันการจองกิจกรรม ${b.ref}`, html));
  if (BREVO && h.notifyEmail) jobs.push(sendEmail(h.notifyEmail, `จองกิจกรรมใหม่ ${b.ref} — ${b.guestName || ""}`, html));
  const token = h.lineChannelToken || LINE_FALLBACK;
  if (token && h.notifyLineTo) {
    jobs.push(pushLine(token, h.notifyLineTo,
      `🎟 จองกิจกรรมใหม่ ${b.ref}\nกิจกรรม: ${b.serviceName}\nวัน: ${b.date}${b.time ? " " + b.time : ""} · ${b.qty} ท่าน\nแขก: ${b.guestName || "-"} (${b.guestTel || "-"})\nยอด: ${money(b.amount)} · ${payTh(b.payStatus, b.payMethod)}`));
  }
  jobs.push(pushHotelChats(h._id, [activityAlert(h, b)]));
  await Promise.allSettled(jobs);
}

// ---------------------------------------------------------------- แขกแจ้งโอนภายหลัง (จองแบบจ่ายทีหลังไว้)
export async function notifyPaidReport(kind, id) {
  const Model = kind === "act" ? ActivityBooking : Booking;
  const b = await Model.findById(id).lean();
  if (!b) return;
  const h = await Hotel.findById(b.hotel).select("+lineChannelToken").lean();
  if (!h) return;
  const jobs = [];
  let card, line;
  if (kind === "act") {
    card = activityAlert(h, b, { report: true });
    line = `💸 แขกแจ้งโอน ${b.ref}\n${b.serviceName} · ${b.date}${b.time ? " " + b.time : ""}\nแขก: ${b.guestName || "-"} (${b.guestTel || "-"})\nยอด ${money(b.amount)}${b.payRef ? " · อ้างอิง " + b.payRef : ""}`;
  } else {
    const t = b.roomType ? await RoomType.findById(b.roomType).select("name").lean() : null;
    const s = summarize(await bookingGroup(b), t);
    card = bookingAlert(h, s, { report: true });
    line = `💸 แขกแจ้งโอน ${s.ref}\nแขก: ${s.guestName || "-"} (${s.guestTel || "-"})\n${s.roomName} · ${s.checkin} → ${s.checkout}\nยอด ${money(s.amount)}${s.payRef ? " · อ้างอิง " + s.payRef : ""}`;
    if (BREVO && h.notifyEmail) jobs.push(sendEmail(h.notifyEmail, `💸 แขกแจ้งโอน ${s.ref} — ${s.guestName}`, bookingEmailHtml(h, s, { forHotel: true })));
  }
  jobs.push(pushHotelChats(h._id, [card]));
  const token = h.lineChannelToken || LINE_FALLBACK;
  if (token && h.notifyLineTo) jobs.push(pushLine(token, h.notifyLineTo, line));
  await Promise.allSettled(jobs);
}

// ---------------------------------------------------------------- ยกเลิก (แขกยกเลิกเอง / ระบบปล่อยห้องอัตโนมัติ)
// list = booking ในเลขจองเดียวกัน (lean) · opts.by = "guest" | "auto" | "hotel" · opts.free = ยกเลิกฟรีไหม · opts.reason = เหตุผล (ที่พักยกเลิก)
export async function notifyCancel(hotelId, list, opts = {}) {
  if (!list || !list.length) return;
  const h = await Hotel.findById(hotelId).select("+lineChannelToken").lean();
  if (!h) return;
  const first = list[0];
  const isAct = /^BA-/.test(String(first.ref || ""));
  const t = !isAct && first.roomType ? await RoomType.findById(first.roomType).select("name").lean() : null;
  const s = isAct ? null : summarize(list.map((x) => ({ ...x, status: "confirmed" })), t);
  const ref = isAct ? first.ref : s.ref;
  const what = isAct ? `🎟 ${first.serviceName} · ${thShort(first.date)}${first.time ? " " + first.time : ""} · ${first.qty} ท่าน`
    : `🛏 ${s.roomName}${s.rooms > 1 ? ` × ${s.rooms} ห้อง` : ""} · ${thShort(s.checkin)} → ${thShort(s.checkout)}`;
  const amount = isAct ? first.amount : s.amount;
  const auto = opts.by === "auto", byHotel = opts.by === "hotel";
  const head = auto ? `⏱ ยกเลิกอัตโนมัติ (ไม่ชำระภายใน ${h.holdHours} ชม.)` : byHotel ? "🏨 ที่พักยกเลิกการจอง" : "❌ แขกยกเลิกการจอง";
  const card = U.flex(`${head} ${ref}`, U.bubble({
    tag: `${head} · ${ref}`, tagColor: auto ? U.C.amber : U.C.red,
    title: first.guestName || "แขก", sub: what,
    lines: [
      U.kv("ยอด", money(amount)),
      U.kv("ชำระ", payTh(first.payStatus, first.payMethod)),
      !auto && !isAct ? U.kv("ยกเลิก", opts.free ? "ฟรี (ก่อนกำหนด)" : "เลยกำหนดยกเลิกฟรี") : null,
      first.payStatus === "paid" || first.payStatus === "reported" ? U.T("💸 แขกจ่าย/แจ้งโอนแล้ว — ตรวจสอบเรื่องคืนเงินตามนโยบายของที่พัก", { size: "xs", color: U.C.amber, margin: "md", wrap: true }) : null,
      U.T("ห้อง/ที่นั่งถูกปล่อยกลับมาว่างแล้ว", { size: "xs", color: U.C.muted, margin: "md" }),
    ],
    buttons: [telUri(first.guestTel) ? U.btn(U.uri("📞 โทรหาแขก", telUri(first.guestTel)), "secondary") : null, U.btn(U.pb("📅 การจองทั้งหมด", "a=bk&hh=" + h._id, "การจอง"), "link")],
  }));
  // ที่พักยกเลิกเอง → ไม่ต้องเด้งกลับเข้า LINE ที่พัก (ประหยัดโควตา) แจ้งแขกทางอีเมลอย่างเดียว
  const jobs = byHotel ? [] : [pushHotelChats(h._id, [card])];
  const token = h.lineChannelToken || LINE_FALLBACK;
  if (!byHotel && token && h.notifyLineTo) jobs.push(pushLine(token, h.notifyLineTo, `${head} ${ref}\nแขก: ${first.guestName || "-"} (${first.guestTel || "-"})\n${what}\nยอด ${money(amount)}`));
  const mail = (title, body) => `<div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;max-width:540px;margin:auto;color:#0f2540"><h2 style="color:${auto ? "#b45309" : "#b91c1c"};margin:0 0 8px">${title}</h2>${body}<p style="color:#94a3b8;font-size:12px">ส่งอัตโนมัติโดย BARN-PARK</p></div>`;
  if (!byHotel && BREVO && h.notifyEmail) jobs.push(sendEmail(h.notifyEmail, `${head} ${ref} — ${first.guestName || ""}`, mail(`${head} — ${esc(h.name)}`, `<p>เลขจอง <b>${esc(ref)}</b><br>แขก ${esc(first.guestName)} · ${esc(first.guestTel)}<br>${esc(what)}<br>ยอด ${money(amount)}</p>`)));
  if (BREVO && first.guestEmail) {
    const B = baseUrl(), link = B && h.slug ? `${B}/book.html?h=${encodeURIComponent(h.slug)}` : "";
    const contact = contactHtml(h);
    jobs.push(sendEmail(first.guestEmail, `${auto || byHotel ? "การจองถูกยกเลิก" : "ยืนยันการยกเลิก"} ${ref} — ${h.name}`, mail(auto || byHotel ? "การจองของคุณถูกยกเลิก" : "ยกเลิกการจองเรียบร้อย",
      `<p>เลขจอง <b>${esc(ref)}</b> · ${esc(h.name)}<br>${esc(what)}</p>` +
      (auto ? `<p>เนื่องจากยังไม่ได้รับการชำระเงินภายในเวลาที่ที่พักกำหนด ระบบจึงปล่อยห้องคืนอัตโนมัติ${link ? ` — หากยังต้องการเข้าพัก <a href="${link}" style="color:#0d9488">จองใหม่ได้ที่นี่</a>` : ""}</p>`
        : byHotel ? `<p>ที่พักได้ยกเลิกการจองนี้แล้ว${opts.reason ? ` (${esc(opts.reason)})` : ""} — หากมีข้อสงสัยหรือต้องการเลื่อนวัน กรุณาติดต่อที่พัก</p>`
        : `<p>${opts.free ? "ยกเลิกภายในกำหนดยกเลิกฟรี" : "ยกเลิกหลังกำหนดยกเลิกฟรี — ที่พักจะติดต่อเรื่องค่าใช้จ่าย (ถ้ามี)"}</p>`) +
      (contact ? `<p style="color:#5b7089;font-size:13px">ติดต่อที่พัก: ${contact}</p>` : ""))));
  }
  await Promise.allSettled(jobs);
}

// แจ้งแอดมินแพลตฟอร์มเมื่อมีโรงแรมสมัครใหม่ (อีเมล + LINE พร้อมปุ่ม "อนุมัติ" ถ้าตั้งค่าไว้)
export async function notifyNewHotel(hotel, ownerEmail, extra = {}) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.SEED_ADMIN_EMAIL || "";
  const adminLineTo = process.env.ADMIN_LINE_TO || "";
  const via = extra.via || "เว็บ";
  const jobs = [];
  if (BREVO && adminEmail) jobs.push(sendEmail(adminEmail, `ที่พักสมัครใหม่: ${hotel.name}`,
    `<div style="font-family:sans-serif"><h3>มีที่พักสมัครใหม่ (สมัครผ่าน${esc(via)})</h3><p>${esc(hotel.name)} · ${esc(hotel.slug)}<br>` +
    `ผู้ติดต่อ: ${esc(extra.contact || "-")} · โทร ${esc(extra.phone || hotel.phone || "-")}<br>เจ้าของ: ${esc(ownerEmail)}<br>ทำเล: ${esc(hotel.location || "-")}</p>` +
    `<p>อนุมัติได้ที่หน้าแอดมิน หรือกดปุ่ม "อนุมัติ" ใน LINE Barn Park</p></div>`));
  if (LINE_FALLBACK && adminLineTo) {
    const card = U.flex("มีที่พักสมัครใหม่: " + hotel.name, U.bubble({
      tag: "🏨 สมัครใหม่ · ผ่าน" + via, tagColor: U.C.amber,
      title: hotel.name, sub: "📍 " + (hotel.location || "-"),
      lines: [
        U.kv("ผู้ติดต่อ", extra.contact || "-"),
        U.kv("โทร", extra.phone || hotel.phone || "-"),
        U.kv("อีเมล", ownerEmail),
        U.kv("ลิงก์", "/book.html?h=" + hotel.slug),
      ],
      buttons: [U.btn(U.pb("✅ อนุมัติ + ส่งรหัส", "a=ap&h=" + hotel._id, "อนุมัติ " + hotel.name))],
    }));
    jobs.push(L.push(adminLineTo, [card]));
  }
  await Promise.allSettled(jobs);
}

// แจ้งแอดมินเรื่องทั่วไป (เช่น โรงแรมขอเชื่อม OTA / ขอคุยกับทีมงาน)
export async function notifyAdmin(subject, lines = []) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.SEED_ADMIN_EMAIL || "";
  const adminLineTo = process.env.ADMIN_LINE_TO || "";
  const jobs = [];
  if (adminLineTo && LINE_FALLBACK) jobs.push(L.push(adminLineTo, [U.text(subject + (lines.length ? "\n" + lines.join("\n") : ""))]));
  if (BREVO && adminEmail) jobs.push(sendEmail(adminEmail, subject, `<div style="font-family:sans-serif"><h3>${esc(subject)}</h3><p>${lines.map(esc).join("<br>")}</p></div>`));
  await Promise.allSettled(jobs);
}

// อีเมลเตือนแขกก่อนเข้าพัก 1 วัน (ฟรีผ่าน Brevo): เวลาเช็คอิน แผนที่ กฎที่พัก ช่องทางติดต่อ + เตือนชำระถ้ายังไม่จ่าย
export async function preArrivalEmails(dateYmd) {
  if (!BREVO) return 0;
  const list = await Booking.find({ checkin: dateYmd, status: { $ne: "cancelled" }, channel: "direct", remindedAt: null }).lean();
  const groups = {};
  for (const b of list) if (b.guestEmail) (groups[String(b.hotel) + "|" + String(b.ref || b._id).replace(/-\d+$/, "")] ||= []).push(b);
  let sent = 0;
  for (const g of Object.values(groups)) {
    const ids = g.map((b) => b._id);
    const claimed = await Booking.updateMany({ _id: { $in: ids }, remindedAt: null }, { $set: { remindedAt: new Date() } });
    if (!claimed.modifiedCount) continue; // มีรอบอื่นส่งไปแล้ว
    const h = await Hotel.findById(g[0].hotel).lean();
    if (!h) continue;
    const t = g[0].roomType ? await RoomType.findById(g[0].roomType).select("name").lean() : null;
    const s = summarize(await bookingGroup(g[0]), t);
    try { await sendEmail(g[0].guestEmail, `พรุ่งนี้เช็คอิน — ${h.name} (${s.ref})`, bookingEmailHtml(h, s, { reminder: true })); sent++; }
    catch (e) { console.error("pre-arrival mail", e.message); }
  }
  return sent;
}

// สรุปรายวันต่อโรงแรม — ใครเช็คอิน/เช็คเอาท์วันนี้ (ส่ง LINE + อีเมล)
// เรียกจาก /api/cron/daily (ให้ cron ภายนอกยิงวันละครั้ง เช่น 7 โมงเช้า)
// LINE Barn Park: ส่งเฉพาะเมื่อตั้ง LINE_DAILY_DIGEST=1 (กินโควตา push วันละ 1 ข้อความ/คน)
export async function dailyDigest() {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // วันที่ตามเวลาไทย
  const hotels = await Hotel.find({ status: { $ne: "paused" } }).select("+lineChannelToken name notifyEmail notifyLineTo");
  const toBarnPark = process.env.LINE_DAILY_DIGEST === "1";
  let sentCount = 0;
  for (const h of hotels) {
    const q = { hotel: h._id, status: { $ne: "cancelled" } };
    const arrivals = await Booking.find({ ...q, checkin: today }).sort("roomType");
    const departures = await Booking.find({ ...q, checkout: today }).sort("roomType");
    const acts = await ActivityBooking.find({ hotel: h._id, date: today, status: { $ne: "cancelled" } }).sort("time");
    if (!arrivals.length && !departures.length && !acts.length) continue;
    const rts = await RoomType.find({ hotel: h._id }).select("name");
    const rn = {}; rts.forEach((t) => (rn[String(t._id)] = t.name));
    const bf = (b) => (b.breakfast === "included" || b.breakfast === "added" ? " · 🍳" : "");
    const line = (b) => `• ${b.guestName || "-"}${b.guestTel ? " (" + b.guestTel + ")" : ""} — ${rn[String(b.roomType)] || "ห้อง"}${b.pax ? " · " + b.pax + " คน" : ""}${bf(b)}${b.note ? "\n   📝 " + b.note : ""}`;
    const text =
      `📋 สรุปวันนี้ ${today} — ${h.name}\n\n` +
      `🟢 เช็คอินวันนี้ ${arrivals.length} ราย\n` + (arrivals.map(line).join("\n") || "— ไม่มี —") +
      `\n\n🔵 เช็คเอาท์วันนี้ ${departures.length} ราย\n` + (departures.map(line).join("\n") || "— ไม่มี —") +
      (acts.length ? `\n\n🎟 กิจกรรมวันนี้ ${acts.length} รายการ\n` + acts.map((a) => `• ${a.time ? a.time + " " : ""}${a.serviceName} — ${a.guestName || "-"} · ${a.qty} ท่าน`).join("\n") : "");
    const html =
      `<div style="font-family:sans-serif;max-width:520px;margin:auto;color:#0f2540">` +
      `<h2 style="color:#0d9488;margin:0 0 4px">สรุปวันนี้ — ${esc(h.name)}</h2><p style="color:#5b7089;margin:0 0 14px">${today}</p>` +
      `<h3 style="margin:0 0 6px">🟢 เช็คอินวันนี้ (${arrivals.length})</h3><ul style="padding-left:18px;margin:0 0 14px">${arrivals.map((b) => `<li>${esc(b.guestName) || "-"} — ${esc(rn[String(b.roomType)]) || "ห้อง"}${b.guestTel ? " · " + esc(b.guestTel) : ""}${bf(b)}${b.note ? `<br><span style="color:#5b7089">📝 ${esc(b.note)}</span>` : ""}</li>`).join("") || "<li>ไม่มี</li>"}</ul>` +
      `<h3 style="margin:0 0 6px">🔵 เช็คเอาท์วันนี้ (${departures.length})</h3><ul style="padding-left:18px;margin:0">${departures.map((b) => `<li>${esc(b.guestName) || "-"} — ${esc(rn[String(b.roomType)]) || "ห้อง"}</li>`).join("") || "<li>ไม่มี</li>"}</ul>` +
      `<p style="color:#94a3b8;font-size:12px;margin-top:16px">ส่งอัตโนมัติโดย BARN-PARK</p></div>`;
    const jobs = [];
    const token = (h.lineChannelToken) || LINE_FALLBACK;
    if (token && h.notifyLineTo) jobs.push(pushLine(token, h.notifyLineTo, text));
    if (toBarnPark) jobs.push(pushHotelChats(h._id, [U.text(text, [U.q("📅 การจอง", "a=bk&hh=" + h._id, "การจอง")])]));
    if (BREVO && h.notifyEmail) jobs.push(sendEmail(h.notifyEmail, `สรุปวันนี้ ${today} — ${h.name}`, html));
    if (jobs.length) { await Promise.allSettled(jobs); sentCount++; }
  }
  const tmr = new Date(Date.now() + 31 * 3600e3).toISOString().slice(0, 10); // พรุ่งนี้ (เวลาไทย)
  const reminders = await preArrivalEmails(tmr).catch((e) => { console.error("pre-arrival", e.message); return 0; });
  return { date: today, hotelsNotified: sentCount, reminders };
}

export async function sendEmail(to, subject, html) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO, "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ sender: { email: SENDER_EMAIL, name: SENDER_NAME }, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!r.ok) throw new Error("brevo email " + r.status + " " + (await r.text()));
}
async function pushLine(token, userId, text) {
  const r = await fetch((process.env.LINE_API_BASE || "https://api.line.me") + "/v2/bot/message/push", {
    method: "POST",
    headers: { "authorization": "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ to: userId, messages: [{ type: "text", text: String(text).slice(0, 4900) }] }),
  });
  if (!r.ok) throw new Error("line " + r.status + " " + (await r.text()));
}
