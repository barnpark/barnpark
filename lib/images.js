// ===== จัดการรูป: ย่อรูปที่ส่งมาทาง LINE แล้วเก็บเป็น data URL (แบบเดียวกับที่หน้าเว็บอัปโหลด) =====
// ใช้ไลบรารี sharp ถ้าติดตั้งได้ (ย่อ + หมุนตาม EXIF) — ถ้าไม่มี ระบบยังใช้งานได้ แต่รับเฉพาะรูปไม่ใหญ่เกินไป
let sharpMod;
async function getSharp() {
  if (sharpMod === undefined) {
    try { sharpMod = (await import("sharp")).default; } catch { sharpMod = null; }
  }
  return sharpMod;
}

const MAX_RAW = 1.5 * 1024 * 1024; // ถ้าไม่มี sharp รับรูปดิบได้ไม่เกิน ~1.5MB

export function sniffType(buf) {
  if (!buf || buf.length < 4) return "";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  return "";
}

// buffer รูป → data URL JPEG ขนาดไม่เกิน max px (ด้านยาว)
export async function toDataUrl(buf, { max = 1024, quality = 80 } = {}) {
  const sharp = await getSharp();
  if (sharp) {
    const out = await sharp(buf, { failOn: "none" }).rotate()
      .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality }).toBuffer();
    return "data:image/jpeg;base64," + out.toString("base64");
  }
  const type = sniffType(buf);
  if (!type) throw new Error("ไฟล์นี้ไม่ใช่รูป JPG/PNG");
  if (buf.length > MAX_RAW) throw new Error("รูปใหญ่เกินไป ลองส่งแบบปกติ (ไม่ใช่ภาพต้นฉบับ)");
  return "data:" + type + ";base64," + buf.toString("base64");
}

// โลโก้: ตัดขอบว่างรอบรูป + ย่อด้านยาวไม่เกิน 600px + เก็บเป็น PNG (พื้นใสยังใสอยู่) → { dataUrl, aspect }
export async function toLogoDataUrl(buf) {
  const sharp = await getSharp();
  if (sharp) {
    const base = await sharp(buf, { failOn: "none" }).rotate().png().toBuffer();
    let src = base;
    try {
      const t = await sharp(base).trim({ threshold: 14 }).png().toBuffer({ resolveWithObject: true });
      if (t.info.width >= 16 && t.info.height >= 16) src = t.data; // ถ้าตัดแล้วเล็กผิดปกติ ใช้รูปเดิม
    } catch {}
    const out = await sharp(src).resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    const { width, height } = out.info;
    return { dataUrl: "data:image/png;base64," + out.data.toString("base64"), aspect: height ? Math.round((width / height) * 1000) / 1000 : 1 };
  }
  const type = sniffType(buf);
  if (!type) throw new Error("ไฟล์นี้ไม่ใช่รูป PNG/JPG");
  if (buf.length > MAX_RAW) throw new Error("ไฟล์โลโก้ใหญ่เกินไป");
  let aspect = 1;
  if (type === "image/png" && buf.length > 24) { const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20); if (w && h) aspect = Math.round((w / h) * 1000) / 1000; }
  return { dataUrl: "data:" + type + ";base64," + buf.toString("base64"), aspect };
}

export function parseDataUrl(s) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(String(s || ""));
  if (!m) return null;
  return { type: m[1], buf: Buffer.from(m[2], "base64") };
}

// ย่อให้พอดีข้อกำหนดรูปใน LINE (ไม่เกิน 1024px) — มีแคชในหน่วยความจำเล็ก ๆ
const cache = new Map();
export async function fitForLine(key, buf, type) {
  if (cache.has(key)) return cache.get(key);
  let out = { buf, type };
  const sharp = await getSharp();
  if (sharp) {
    try {
      const b = await sharp(buf, { failOn: "none" }).rotate()
        .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      out = { buf: b, type: "image/jpeg" };
    } catch {}
  }
  cache.set(key, out);
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  return out;
}
