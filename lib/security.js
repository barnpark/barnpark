// ===== ตัวช่วยด้านความปลอดภัย =====
import crypto from "crypto";

// เลขอ้างอิงแบบสุ่ม (เดาไม่ได้) เช่น BP-K7P4QX
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function mkRef(prefix = "BP") {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHA[crypto.randomInt(ALPHA.length)];
  return prefix + "-" + s;
}

// รูปที่ยอมให้เก็บ: data URL ของรูปจริง / ลิงก์ http(s) ที่ไม่มีอักขระอันตราย / path รูปภายในระบบ
const DATA_IMG = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const HTTP_IMG = /^https?:\/\/[^\s"'()<>\\]+$/i;
const LOCAL_IMG = /^\/api\/public\/img\/[a-z]+\/[a-f0-9]{24}\/\d+(\?[\w=&.-]*)?$/;
export const isSafeImg = (s) => s === "" || s == null || DATA_IMG.test(String(s)) || HTTP_IMG.test(String(s)) || LOCAL_IMG.test(String(s));

// ตรวจฟิลด์รูปใน body — คืนข้อความ error ถ้าไม่ผ่าน
export function badImageFields(body = {}, fields = []) {
  for (const f of fields) {
    const v = body[f];
    if (v === undefined) continue;
    if (Array.isArray(v)) { if (v.length > 4 || !v.every(isSafeImg)) return f; }
    else if (!isSafeImg(v)) return f;
  }
  return null;
}

// กันการยิง operator ของ MongoDB ผ่าน input (เช่น {"slug":{"$ne":null}})
function hasOperator(v, depth = 0) {
  if (!v || typeof v !== "object" || depth > 8) return false;
  for (const k of Object.keys(v)) {
    if (k.startsWith("$") || k.includes(".")) return true;
    if (hasOperator(v[k], depth + 1)) return true;
  }
  return false;
}
export function blockOperators(req, res, next) {
  if (hasOperator(req.body) || hasOperator(req.query) || hasOperator(req.params)) return res.status(400).json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" });
  next();
}

// HTTP security headers พื้นฐาน
export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if ((req.get("x-forwarded-proto") || "").startsWith("https")) res.setHeader("Strict-Transport-Security", "max-age=15552000");
  next();
}
