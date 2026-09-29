// ส่งอีเมลผ่าน Brevo — ใช้ส่ง OTP ตอนล็อกอิน
const BREVO        = process.env.BREVO_API_KEY || "";
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "noreply@barnpark.co";
const SENDER_NAME  = process.env.BREVO_SENDER_NAME || "BARN-PARK";

export function brevoReady() { return !!BREVO; }

export async function sendOtp(to, code) {
  if (!BREVO) return false;
  const html = `<div style="font-family:sans-serif;max-width:420px;margin:auto">
    <h2 style="color:#0d9488;margin:0 0 8px">รหัสเข้าสู่ระบบ BARN-PARK</h2>
    <p style="color:#0f2540">รหัส OTP ของคุณคือ</p>
    <p style="font-size:30px;font-weight:800;letter-spacing:6px;color:#0f2540;margin:8px 0">${code}</p>
    <p style="color:#5b7089;font-size:13px">รหัสมีอายุ 5 นาที · หากคุณไม่ได้เป็นผู้ขอเข้าสู่ระบบ กรุณาเพิกเฉยอีเมลนี้</p>
  </div>`;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO, "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ sender: { email: SENDER_EMAIL, name: SENDER_NAME }, to: [{ email: to }], subject: "รหัสเข้าสู่ระบบ BARN-PARK: " + code, htmlContent: html }),
  });
  if (!r.ok) throw new Error("brevo otp " + r.status + " " + (await r.text()));
  return true;
}
