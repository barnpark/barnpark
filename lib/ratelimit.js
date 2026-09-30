// จำกัดจำนวนคำขอต่อ IP แบบง่าย (in-memory) — กัน brute-force / สแปม
// หมายเหตุ: เก็บในหน่วยความจำของเครื่องเดียว เพียงพอสำหรับ Render free tier (instance เดียว)
const hits = new Map();

export function rateLimit({ windowMs = 60000, max = 30, message } = {}) {
  return (req, res, next) => {
    const fwd = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const key = fwd || req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset < now) { e = { count: 0, reset: now + windowMs }; hits.set(key, e); }
    e.count++;
    if (e.count > max) {
      const wait = Math.ceil((e.reset - now) / 1000);
      res.set("Retry-After", String(wait));
      return res.status(429).json({ error: message || `คำขอถี่เกินไป กรุณารอ ${wait} วินาทีแล้วลองใหม่` });
    }
    next();
  };
}

// เคลียร์รายการหมดอายุเป็นระยะ (ไม่กันไม่ให้ process ปิด)
const timer = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}, 5 * 60 * 1000);
if (timer.unref) timer.unref();
