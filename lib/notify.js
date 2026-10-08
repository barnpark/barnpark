import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Booking from "../models/Booking.js";

const BREVO        = process.env.BREVO_API_KEY || "";
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "noreply@barnpark.co";
const SENDER_NAME  = process.env.BREVO_SENDER_NAME || "BARN-PARK";
const SMS_SENDER   = process.env.BREVO_SMS_SENDER || "BARNPARK";
const LINE_FALLBACK = process.env.LINE_CHANNEL_TOKEN || ""; // OA กลาง (ถ้ามี) — ปกติใช้ token ต่อโรงแรม

const money = (n) => "฿" + Number(n || 0).toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// เรียกหลังสร้าง booking (fire-and-forget) — ส่งตามช่องที่แขกเลือก + ใช้ LINE OA ของโรงแรมนั้น
export async function notifyBooking(bookingId) {
  const b = await Booking.findById(bookingId);
  if (!b || b.status === "cancelled") return;
  const h = await Hotel.findById(b.hotel).select("+lineChannelToken name phone lineId notifyEmail notifyLineTo cancelDays allowGuestCancel");
  const t = await RoomType.findById(b.roomType);
  const nights = Math.max(1, Math.round((new Date(b.checkout) - new Date(b.checkin)) / 86400000));

  const text =
    `ยืนยันการจอง ${b.ref} — ${h?.name || ""}\n` +
    `ห้อง ${t?.name || ""}\nเช็คอิน ${b.checkin} ถึง ${b.checkout} (${nights} คืน)\nยอดรวม ${money(b.amount)}`;
  const payInfo = b.payStatus === "paid" ? "ชำระเงินแล้ว" : b.payStatus === "reported" ? "แจ้งโอนแล้ว · รอโรงแรมตรวจสอบ" : "ยังไม่ชำระ";
  const cancelNote = (h && h.allowGuestCancel !== false)
    ? `ยกเลิกฟรีก่อนเช็คอินอย่างน้อย ${h?.cancelDays ?? 3} วัน (ยกเลิกได้ที่หน้าจอง)`
    : `หากต้องการยกเลิก กรุณาติดต่อที่พักโดยตรง`;
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;color:#0f2540">
      <h2 style="color:#0d9488;margin:0 0 8px">ยืนยันการจอง — ${esc(h?.name) || "ที่พัก"}</h2>
      <p>สวัสดีคุณ ${esc(b.guestName) || ""} การจองของคุณได้รับการยืนยันแล้ว 🎉</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="color:#5b7089;padding:6px 0">หมายเลขการจอง</td><td style="text-align:right"><b>${b.ref || ""}</b></td></tr>
        <tr><td style="color:#5b7089;padding:6px 0">ห้อง</td><td style="text-align:right">${esc(t?.name) || ""}</td></tr>
        <tr><td style="color:#5b7089;padding:6px 0">เช็คอิน</td><td style="text-align:right">${b.checkin}</td></tr>
        <tr><td style="color:#5b7089;padding:6px 0">เช็คเอาท์</td><td style="text-align:right">${b.checkout} (${nights} คืน)</td></tr>
        <tr><td style="color:#5b7089;padding:6px 0">ยอดรวม</td><td style="text-align:right"><b>${money(b.amount)}</b></td></tr>
        <tr><td style="color:#5b7089;padding:6px 0">สถานะชำระเงิน</td><td style="text-align:right">${payInfo}</td></tr>
      </table>
      <p style="color:#5b7089;font-size:13px;margin-top:10px">${cancelNote}</p>
      <p style="color:#5b7089;font-size:13px">ติดต่อที่พัก: ${esc(h?.phone) || ""} ${h?.lineId ? "· LINE " + esc(h.lineId) : ""}</p>
      <p style="color:#94a3b8;font-size:12px">ส่งอัตโนมัติโดย BARN-PARK</p>
    </div>`;

  const want = (b.notifyChannel || "email").toLowerCase();
  const lineToken = (h && h.lineChannelToken) || LINE_FALLBACK; // ★ LINE OA ต่อโรงแรม
  const jobs = [];

  if (want !== "none") {
    // ส่งอีเมลยืนยันให้แขกเสมอเมื่อมีอีเมล (ปิด loop การจอง)
    if (BREVO && b.guestEmail) jobs.push(sendEmail(b.guestEmail, `ยืนยันการจอง ${b.ref}`, html));
    // ช่องทางเสริมตามที่แขกเลือก
    if (want === "sms" && BREVO && b.guestTel) jobs.push(sendSMS(b.guestTel, text));
    if (want === "line" && lineToken && b.lineUserId) jobs.push(pushLine(lineToken, b.lineUserId, text));
    // ไม่มีอีเมลแต่มีเบอร์ → ส่ง SMS แทน
    if (!b.guestEmail && want !== "sms" && BREVO && b.guestTel) jobs.push(sendSMS(b.guestTel, text));
  }
  if (BREVO && h?.notifyEmail) jobs.push(sendEmail(h.notifyEmail, `การจองใหม่ ${b.ref} — ${b.guestName || ""}`, html));

  // ★ แจ้งเตือนเข้า LINE OA ของโรงแรมเอง (ให้เจ้าของรู้ทันทีเมื่อมีจองใหม่)
  const hotelLineToken = (h && h.lineChannelToken) || LINE_FALLBACK;
  if (hotelLineToken && h?.notifyLineTo) {
    const payInfo = b.payStatus === "paid" ? "ชำระแล้ว" : b.payStatus === "reported" ? "แจ้งโอน รอตรวจ" : "ยังไม่ชำระ";
    const alert =
      `🆕 จองใหม่ ${b.ref}\n` +
      `แขก: ${b.guestName || "-"} (${b.guestTel || "-"})\n` +
      `ห้อง: ${t?.name || "-"}\n` +
      `เข้าพัก: ${b.checkin} → ${b.checkout} (${nights} คืน)\n` +
      `ยอด: ${money(b.amount)} · ${payInfo}`;
    jobs.push(pushLine(hotelLineToken, h.notifyLineTo, alert));
  }

  await Promise.allSettled(jobs);
}

// แจ้งแอดมินแพลตฟอร์มเมื่อมีโรงแรมสมัครใหม่ (อีเมล + LINE ถ้าตั้งค่าไว้)
export async function notifyNewHotel(hotel, ownerEmail) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.SEED_ADMIN_EMAIL || "";
  const adminLineTo = process.env.ADMIN_LINE_TO || "";
  const text =
    `🏨 มีที่พักสมัครใหม่กับ BARN-PARK\n` +
    `ชื่อ: ${hotel.name}\nslug: ${hotel.slug}\nทำเล: ${hotel.location || "-"}\n` +
    `เจ้าของ: ${ownerEmail}\nลิงก์จอง: /book.html?h=${hotel.slug}`;
  const jobs = [];
  if (BREVO && adminEmail) jobs.push(sendEmail(adminEmail, `ที่พักสมัครใหม่: ${hotel.name}`,
    `<div style="font-family:sans-serif"><h3>มีที่พักสมัครใหม่</h3><p>${esc(hotel.name)} · ${esc(hotel.slug)}<br>เจ้าของ: ${esc(ownerEmail)}<br>ทำเล: ${esc(hotel.location || "-")}</p></div>`));
  if (LINE_FALLBACK && adminLineTo) jobs.push(pushLine(LINE_FALLBACK, adminLineTo, text));
  await Promise.allSettled(jobs);
}

// สรุปรายวันต่อโรงแรม — ใครเช็คอิน/เช็คเอาท์วันนี้ (ส่ง LINE + อีเมล)
// เรียกจาก /api/cron/daily (ให้ cron ภายนอกยิงวันละครั้ง เช่น 7 โมงเช้า)
export async function dailyDigest() {
  const today = new Date().toISOString().slice(0, 10);
  const hotels = await Hotel.find({ status: { $ne: "paused" } }).select("+lineChannelToken name notifyEmail notifyLineTo");
  let sentCount = 0;
  for (const h of hotels) {
    const q = { hotel: h._id, status: { $ne: "cancelled" } };
    const arrivals = await Booking.find({ ...q, checkin: today }).sort("roomType");
    const departures = await Booking.find({ ...q, checkout: today }).sort("roomType");
    if (!arrivals.length && !departures.length) continue;
    // ชื่อห้อง
    const rts = await RoomType.find({ hotel: h._id }).select("name");
    const rn = {}; rts.forEach((t) => (rn[String(t._id)] = t.name));
    const line = (b) => `• ${b.guestName || "-"}${b.guestTel ? " (" + b.guestTel + ")" : ""} — ${rn[String(b.roomType)] || "ห้อง"}${b.pax ? " · " + b.pax + " คน" : ""}`;
    const text =
      `📋 สรุปวันนี้ ${today} — ${h.name}\n\n` +
      `🟢 เช็คอินวันนี้ ${arrivals.length} ราย\n` + (arrivals.map(line).join("\n") || "— ไม่มี —") +
      `\n\n🔵 เช็คเอาท์วันนี้ ${departures.length} ราย\n` + (departures.map(line).join("\n") || "— ไม่มี —");
    const html =
      `<div style="font-family:sans-serif;max-width:520px;margin:auto;color:#0f2540">` +
      `<h2 style="color:#0d9488;margin:0 0 4px">สรุปวันนี้ — ${esc(h.name)}</h2><p style="color:#5b7089;margin:0 0 14px">${today}</p>` +
      `<h3 style="margin:0 0 6px">🟢 เช็คอินวันนี้ (${arrivals.length})</h3><ul style="padding-left:18px;margin:0 0 14px">${arrivals.map((b) => `<li>${esc(b.guestName) || "-"} — ${esc(rn[String(b.roomType)]) || "ห้อง"}${b.guestTel ? " · " + esc(b.guestTel) : ""}</li>`).join("") || "<li>ไม่มี</li>"}</ul>` +
      `<h3 style="margin:0 0 6px">🔵 เช็คเอาท์วันนี้ (${departures.length})</h3><ul style="padding-left:18px;margin:0">${departures.map((b) => `<li>${esc(b.guestName) || "-"} — ${esc(rn[String(b.roomType)]) || "ห้อง"}</li>`).join("") || "<li>ไม่มี</li>"}</ul>` +
      `<p style="color:#94a3b8;font-size:12px;margin-top:16px">ส่งอัตโนมัติโดย BARN-PARK</p></div>`;
    const jobs = [];
    const token = (h.lineChannelToken) || LINE_FALLBACK;
    if (token && h.notifyLineTo) jobs.push(pushLine(token, h.notifyLineTo, text));
    if (BREVO && h.notifyEmail) jobs.push(sendEmail(h.notifyEmail, `สรุปวันนี้ ${today} — ${h.name}`, html));
    if (jobs.length) { await Promise.allSettled(jobs); sentCount++; }
  }
  return { date: today, hotelsNotified: sentCount };
}

async function sendEmail(to, subject, html) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO, "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ sender: { email: SENDER_EMAIL, name: SENDER_NAME }, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!r.ok) throw new Error("brevo email " + r.status + " " + (await r.text()));
}
async function sendSMS(to, text) {
  const num = String(to).replace(/[^0-9]/g, "").replace(/^0/, "66"); // 08x → 668x
  const r = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
    method: "POST",
    headers: { "api-key": BREVO, "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ type: "transactional", sender: SMS_SENDER, recipient: num, content: text }),
  });
  if (!r.ok) throw new Error("brevo sms " + r.status + " " + (await r.text()));
}
async function pushLine(token, userId, text) {
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "authorization": "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] }),
  });
  if (!r.ok) throw new Error("line " + r.status + " " + (await r.text()));
}
