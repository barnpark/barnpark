// จำกัดจำนวนคำขอต่อ IP แบบง่าย (in-memory) — กัน brute-force / สแปม
// หมายเหตุ: เก็บในหน่วยความจำของเครื่องเดียว เพียงพอสำหรับ Render (instance เดียว)
import net from "net";

// ช่วง IP ของ Cloudflare (https://www.cloudflare.com/ips/) — เปลี่ยนน้อยมาก ถ้ามีประกาศใหม่ตั้ง env CF_IPS=ช่วง1,ช่วง2,... แทนได้
const CF_DEFAULT = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];
let cfList = null;
function cfBlock() {
  if (cfList) return cfList;
  cfList = new net.BlockList();
  const ranges = process.env.CF_IPS ? process.env.CF_IPS.split(",").map((s) => s.trim()).filter(Boolean) : CF_DEFAULT;
  for (const c of ranges) {
    const [addr, bits] = c.split("/");
    const v = net.isIP(addr);
    if (v) cfList.addSubnet(addr, Number(bits), v === 6 ? "ipv6" : "ipv4");
  }
  return cfList;
}
export function isCloudflareIp(ip) {
  const a = String(ip || "").replace(/^::ffff:/, "");
  const v = net.isIP(a);
  return v ? cfBlock().check(a, v === 6 ? "ipv6" : "ipv4") : false;
}

// IP ภายใน (proxy/load balancer ของผู้ให้บริการ) — ข้ามตอนหา IP จริง
const PRIVATE = new net.BlockList();
for (const [a, b, t] of [["10.0.0.0", 8, "ipv4"], ["172.16.0.0", 12, "ipv4"], ["192.168.0.0", 16, "ipv4"], ["127.0.0.0", 8, "ipv4"], ["100.64.0.0", 10, "ipv4"], ["169.254.0.0", 16, "ipv4"], ["fc00::", 7, "ipv6"], ["fe80::", 10, "ipv6"], ["::1", 128, "ipv6"]]) PRIVATE.addSubnet(a, b, t);
const norm = (ip) => String(ip || "").trim().replace(/^::ffff:/, "");
const isPrivate = (ip) => { const v = net.isIP(ip); return v ? PRIVATE.check(ip, v === 6 ? "ipv6" : "ipv4") : true; };

// IP จริงของผู้ใช้ ที่ปลอมไม่ได้ (ใช้เป็นกุญแจของตัวจำกัดคำขอ)
// - บน Render (มี env RENDER=true ให้อัตโนมัติ): ทุกคำขอผ่าน Cloudflare ของ Render ก่อนเสมอ ซึ่งเขียนทับ CF-Connecting-IP ด้วย IP จริง
//   (X-Forwarded-For บน Render ผู้ใช้เติมปลอมมาได้ และตัวท้ายสุดเป็น IP ของ Cloudflare ที่คนจำนวนมากใช้ร่วมกัน จึงไม่ใช้)
// - ที่อื่น: ใช้ hop ขวาสุดที่ไม่ใช่ IP ภายใน — ถ้า hop นั้นเป็น Cloudflare จริง จึงเชื่อ CF-Connecting-IP
// - TRUST_CF_HEADER=1 บังคับเชื่อ CF-Connecting-IP (ใช้เมื่อย้ายไปโฮสต์อื่นที่อยู่หลัง Cloudflare เสมอ)
export function clientIp(req) {
  const h = req.headers || {};
  const cf = norm(h["cf-connecting-ip"]);
  if ((process.env.RENDER === "true" || process.env.TRUST_CF_HEADER === "1") && net.isIP(cf)) return cf;
  const hops = String(h["x-forwarded-for"] || "").split(",").map(norm).filter(Boolean);
  hops.push(norm(req.socket?.remoteAddress));
  let peer = "";
  for (let i = hops.length - 1; i >= 0; i--) if (hops[i] && !isPrivate(hops[i])) { peer = hops[i]; break; }
  if (peer && isCloudflareIp(peer) && net.isIP(cf)) return cf;
  return peer || hops.filter(Boolean).pop() || "unknown";
}

export function rateLimit({ windowMs = 60000, max = 30, message } = {}) {
  const hits = new Map(); // แยกตัวนับต่อจุด (login / ยกเลิก / จอง ไม่ปนกัน)
  const timer = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 5 * 60 * 1000);
  if (timer.unref) timer.unref();
  return (req, res, next) => {
    const key = clientIp(req);
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
