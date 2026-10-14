// URL หลักของเว็บ (ใช้สร้างลิงก์ในข้อความ LINE / อีเมล)
// ตั้ง env PUBLIC_URL ได้ (เช่น https://barn-park.onrender.com) — ถ้าไม่ตั้ง จะจำจาก request ที่เชื่อถือได้
// (webhook ของ LINE ที่ผ่านการตรวจลายเซ็นแล้ว หรือแอดมินที่ล็อกอินแล้ว)
let remembered = "";

export function rememberBase(req) {
  if (process.env.PUBLIC_URL) return;
  const host = String(req.get("host") || "");
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return;
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  remembered = (proto === "http" && !/^(localhost|127\.)/.test(host) ? "https" : proto) + "://" + host;
}

export function baseUrl() {
  return String(process.env.PUBLIC_URL || remembered || "").replace(/\/+$/, "");
}
