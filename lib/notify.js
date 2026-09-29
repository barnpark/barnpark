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
  const h = await Hotel.findById(b.hotel).select("+lineChannelToken name phone lineId notifyEmail");
  const t = await RoomType.findById(b.roomType);
  const nights = Math.max(1, Math.round((new Date(b.checkout) - new Date(b.checkin)) / 86400000));

  const text =
    `ยืนยันการจอง ${b.ref} — ${h?.name || ""}\n` +
    `ห้อง ${t?.name || ""}\nเช็คอิน ${b.checkin} ถึง ${b.checkout} (${nights} คืน)\nยอดรวม ${money(b.amount)}`;
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
      </table>
      <p style="color:#5b7089;font-size:13px">ติดต่อที่พัก: ${esc(h?.phone) || ""} ${h?.lineId ? "· LINE " + esc(h.lineId) : ""}</p>
      <p style="color:#94a3b8;font-size:12px">ส่งอัตโนมัติโดย BARN-PARK</p>
    </div>`;

  const want = (b.notifyChannel || "email").toLowerCase();
  const lineToken = (h && h.lineChannelToken) || LINE_FALLBACK; // ★ LINE OA ต่อโรงแรม
  const jobs = [];
  let sent = false;

  if (want === "line" && lineToken && b.lineUserId) { jobs.push(pushLine(lineToken, b.lineUserId, text)); sent = true; }
  if (want === "sms" && BREVO && b.guestTel)        { jobs.push(sendSMS(b.guestTel, text)); sent = true; }
  if (!sent && want !== "none") {
    if (BREVO && b.guestEmail)   { jobs.push(sendEmail(b.guestEmail, `ยืนยันการจอง ${b.ref}`, html)); sent = true; }
    else if (BREVO && b.guestTel){ jobs.push(sendSMS(b.guestTel, text)); sent = true; }
  }
  if (BREVO && h?.notifyEmail) jobs.push(sendEmail(h.notifyEmail, `การจองใหม่ ${b.ref} — ${b.guestName || ""}`, html));

  await Promise.allSettled(jobs);
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
