// ============================================================
// Barn Pak · Edge Function "notify"
// ส่งข้อความยืนยันการจองอัตโนมัติ เมื่อมีแถวใหม่ใน public.bookings
// ทำงานอัตโนมัติผ่าน Supabase "Database Webhook" (Insert on bookings)
//
// secret ทั้งหมดอยู่ฝั่งเซิร์ฟเวอร์ (Supabase Secrets) — ไม่มีทางหลุดไปหน้าเว็บ
// ตั้งค่า secret:
//   supabase secrets set NOTIFY_SECRET=<สุ่มยาว ๆ> BREVO_API_KEY=xkeysib-xxx BREVO_SENDER_EMAIL=noreply@yourdomain.com BREVO_SENDER_NAME="BARN-PARK" BREVO_SMS_SENDER=BARNPARK
// deploy:
//   supabase functions deploy notify --no-verify-jwt
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOOK_SECRET   = Deno.env.get("NOTIFY_SECRET") || "";
// Brevo (อีเมล + SMS) — ตั้งใน Supabase Secrets
const BREVO_KEY     = Deno.env.get("BREVO_API_KEY") || "";
const SENDER_EMAIL  = Deno.env.get("BREVO_SENDER_EMAIL") || "noreply@barnpark.co"; // ต้องเป็นโดเมน/อีเมลที่ verify ใน Brevo
const SENDER_NAME   = Deno.env.get("BREVO_SENDER_NAME") || "BARN-PARK";
const SMS_SENDER    = Deno.env.get("BREVO_SMS_SENDER") || "BARNPARK";               // ชื่อผู้ส่ง SMS (a-z0-9 ≤11 ตัว)
// LINE (ทางเลือก)
const LINE_TOKEN    = Deno.env.get("LINE_CHANNEL_TOKEN") || "";                     // LINE Messaging API channel access token

const money = (n: number) => "฿" + Number(n || 0).toLocaleString("en-US");

Deno.serve(async (req) => {
  try {
    // ป้องกันคนอื่นยิงเข้ามามั่ว: ต้องแนบ header x-notify-secret ให้ตรง (ตั้งใน Database Webhook)
    if (HOOK_SECRET && req.headers.get("x-notify-secret") !== HOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = await req.json();
    const b = payload.record || payload.booking || payload; // webhook ส่งมาเป็น { type, record, ... }
    if (!b || !b.id) return json({ skipped: "no record" });
    if (b.status === "cancelled") return json({ skipped: "cancelled" });

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const [{ data: hotel }, { data: room }] = await Promise.all([
      sb.from("hotels").select("name,phone,line_id,notify_email").eq("id", b.hotel_id).single(),
      b.room_type_id
        ? sb.from("room_types").select("name").eq("id", b.room_type_id).single()
        : Promise.resolve({ data: null }),
    ]);

    const roomName = room?.name || "ห้องพัก";
    const nights = Math.max(1, Math.round(
      (new Date(b.checkout).getTime() - new Date(b.checkin).getTime()) / 86400000));
    const ref = "BP-" + String(b.id).slice(0, 8).toUpperCase();

    const html = `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;color:#152238">
        <h2 style="color:#4f7d6e;margin:0 0 8px">ยืนยันการจอง — ${esc(hotel?.name) || "ที่พัก"}</h2>
        <p>สวัสดีคุณ ${esc(b.guest_name) || ""} การจองของคุณได้รับการยืนยันแล้ว 🎉</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="color:#64748b;padding:6px 0">หมายเลขการจอง</td><td style="text-align:right"><b>${ref}</b></td></tr>
          <tr><td style="color:#64748b;padding:6px 0">ห้อง</td><td style="text-align:right">${esc(roomName)}</td></tr>
          <tr><td style="color:#64748b;padding:6px 0">เช็คอิน</td><td style="text-align:right">${b.checkin}</td></tr>
          <tr><td style="color:#64748b;padding:6px 0">เช็คเอาท์</td><td style="text-align:right">${b.checkout} (${nights} คืน)</td></tr>
          <tr><td style="color:#64748b;padding:6px 0">ยอดรวม</td><td style="text-align:right"><b>${money(b.amount)}</b></td></tr>
        </table>
        <p style="color:#64748b;font-size:13px">ติดต่อที่พัก: ${esc(hotel?.phone) || ""} ${hotel?.line_id ? ("· LINE " + esc(hotel.line_id)) : ""}</p>
        <p style="color:#94a3b8;font-size:12px">ส่งอัตโนมัติโดย Barn Pak</p>
      </div>`;

    // ---- ส่งตามช่องทางที่แขกเลือก (flexible) พร้อม fallback ----
    const want = (b.notify_channel || "email").toLowerCase();
    const text = `ยืนยันการจอง ${ref} — ${hotel?.name || ""}\nห้อง ${roomName}\nเช็คอิน ${b.checkin} ถึง ${b.checkout} (${nights} คืน)\nยอดรวม ${money(b.amount)}`;

    const jobs: Promise<unknown>[] = [];
    let guestSent = false;
    if (want === "line" && LINE_TOKEN && b.line_user_id) { jobs.push(pushLine(b.line_user_id, text)); guestSent = true; }
    if (want === "sms" && BREVO_KEY && b.guest_tel)      { jobs.push(sendSMS(b.guest_tel, text)); guestSent = true; }
    if (!guestSent && want !== "none") {
      // fallback: อีเมลก่อน แล้ว SMS — เผื่อยังไม่ได้ตั้งช่องที่เลือก หรือแขกยังไม่แอด LINE
      if (BREVO_KEY && b.guest_email) { jobs.push(sendEmail(b.guest_email, `ยืนยันการจอง ${ref} — ${hotel?.name || ""}`, html)); guestSent = true; }
      else if (BREVO_KEY && b.guest_tel) { jobs.push(sendSMS(b.guest_tel, text)); guestSent = true; }
    }
    // สำเนาถึงโรงแรมทางอีเมลเสมอ (ถ้าตั้งไว้)
    if (BREVO_KEY && hotel?.notify_email) jobs.push(sendEmail(hotel.notify_email, `การจองใหม่ ${ref} — ${b.guest_name || ""}`, html));

    const results = await Promise.allSettled(jobs);
    return json({ ok: true, ref, channel: want, guestSent, sent: results.filter(r => r.status === "fulfilled").length });
  } catch (e) {
    // ไม่ให้ error ของการแจ้งเตือนไปกระทบการจอง — คืน 200 เสมอ
    return json({ error: String(e) });
  }
});

// ---- Brevo (Sendinblue) providers ----
async function sendEmail(to: string, subject: string, html: string) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", "accept": "application/json" },
    body: JSON.stringify({
      sender: { email: SENDER_EMAIL, name: SENDER_NAME },
      to: [{ email: to }],
      subject, htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error("brevo email " + r.status + " " + (await r.text()));
  return r.json();
}
// Brevo transactional SMS — recipient ต้องเป็นรูปแบบสากล เช่น 66812345678 (ไม่มี +, 0 นำหน้า)
async function sendSMS(to: string, text: string) {
  const num = to.replace(/[^0-9]/g, "").replace(/^0/, "66"); // 08x… → 668x…
  const r = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ type: "transactional", sender: SMS_SENDER, recipient: num, content: text }),
  });
  if (!r.ok) throw new Error("brevo sms " + r.status + " " + (await r.text()));
  return r.json();
}
// LINE Messaging API push (ต้องมี userId = แขกแอด OA แล้วเท่านั้น)
async function pushLine(userId: string, text: string) {
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Authorization": `Bearer ${LINE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] }),
  });
  if (!r.ok) throw new Error("line " + r.status + " " + (await r.text()));
  return true;
}
function esc(s: unknown) { return String(s ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function json(o: unknown) { return new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } }); }
