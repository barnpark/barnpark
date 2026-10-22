// ===== ที่เก็บไฟล์บน Supabase Storage (ผ่าน REST API ด้วย fetch — ไม่ต้องลง SDK) =====
// รูปห้อง/บริการ/ปก/โลโก้ → bucket สาธารณะ (SUPABASE_BUCKET) แล้วเก็บแค่ลิงก์ https ในฐานข้อมูล
// ไฟล์สำรองข้อมูล → bucket ส่วนตัว (SUPABASE_BACKUP_BUCKET) โหลดได้ผ่านลิงก์ชั่วคราว (signed URL) เท่านั้น
// ยังไม่ตั้ง SUPABASE_URL + SUPABASE_SERVICE_KEY → storeReady() = false และระบบเก็บรูปเป็น data URL เหมือนเดิม
// ห้าม log คีย์ — ข้อความ error ทุกอันไม่มีคีย์ปน
import crypto from "crypto";
import { parseDataUrl } from "./images.js";

const env = (k, d = "") => String(process.env[k] || "").trim() || d;
const cfg = () => ({
  url: env("SUPABASE_URL").replace(/\/+$/, ""), key: env("SUPABASE_SERVICE_KEY"),
  bucket: env("SUPABASE_BUCKET", "barnpark-media"), backup: env("SUPABASE_BACKUP_BUCKET", "barnpark-backups"),
});
export const storeReady = () => { const c = cfg(); return /^https:\/\/[^\s/]+/.test(c.url) && !!c.key; };
export const storeInfo = () => { const c = cfg(); return { ready: storeReady(), bucket: c.bucket, backupBucket: c.backup }; };
export const backupBucket = () => cfg().backup;

const SAFE_KEY = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const okPath = (p) => SAFE_KEY.test(p) && !p.split("/").some((s) => s === "." || s === "..");
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
export const isDataImg = (s) => typeof s === "string" && /^data:image\//i.test(s);

// เรียก Supabase Storage → JSON (หรือ null) · error เป็นภาษาไทย
async function sb(method, path, { body, json, type, headers = {}, timeout = 20000 } = {}) {
  const c = cfg();
  if (!storeReady()) throw new Error("ยังไม่ได้ตั้งค่า Supabase (SUPABASE_URL / SUPABASE_SERVICE_KEY)");
  let r;
  try {
    r = await fetch(c.url + "/storage/v1/" + path, {
      method, body: json !== undefined ? JSON.stringify(json) : body, signal: AbortSignal.timeout(timeout),
      headers: { authorization: "Bearer " + c.key, apikey: c.key, ...(json !== undefined ? { "content-type": "application/json" } : type ? { "content-type": type } : {}), ...headers },
    });
  } catch (e) { throw new Error(e && e.name === "TimeoutError" ? "Supabase ตอบช้าเกินไป ลองใหม่อีกครั้ง" : "เชื่อมต่อ Supabase ไม่ได้ ลองใหม่อีกครั้ง"); }
  const txt = await r.text().catch(() => "");
  let out = null; try { out = txt ? JSON.parse(txt) : null; } catch {}
  if (!r.ok) {
    const msg = String((out && (out.message || out.error)) || "").slice(0, 100);
    throw Object.assign(new Error(`Supabase ไม่รับคำขอ (${r.status}${msg ? " " + msg : ""})`), { status: r.status });
  }
  return out;
}

// ===== ไฟล์ทั่วไป (ใช้ทั้งรูปและไฟล์สำรอง) =====
export async function putObject(bucket, path, buf, type, { upsert = true, cache = "" } = {}) {
  if (!okPath(path)) throw new Error("ชื่อไฟล์ไม่ถูกต้อง");
  await sb("POST", "object/" + enc(bucket) + "/" + enc(path), { body: buf, type, timeout: 60000, headers: { "x-upsert": upsert ? "true" : "false", ...(cache ? { "cache-control": cache } : {}) } });
  return path;
}
// รายการไฟล์ในโฟลเดอร์ (ไม่ลงโฟลเดอร์ย่อย) → [{ name, size, at }]
export async function listObjects(bucket, prefix, { limit = 1000 } = {}) {
  const out = [];
  for (let offset = 0; offset < 20000; offset += limit) {
    const rows = await sb("POST", "object/list/" + enc(bucket), { json: { prefix, limit, offset, sortBy: { column: "name", order: "asc" } } }) || [];
    for (const f of rows) if (f && f.id && f.name) out.push({ name: f.name, size: (f.metadata && f.metadata.size) || 0, at: f.updated_at || f.created_at || null });
    if (rows.length < limit) break;
  }
  return out;
}
export async function removePaths(bucket, paths) {
  const list = [...new Set(paths)].filter(okPath);
  for (let i = 0; i < list.length; i += 100) await sb("DELETE", "object/" + enc(bucket), { json: { prefixes: list.slice(i, i + 100) } });
  return list.length;
}
// ลิงก์ดาวน์โหลดชั่วคราวของไฟล์ใน bucket ส่วนตัว
export async function signedUrl(bucket, path, expiresIn = 300) {
  if (!okPath(path)) throw new Error("ชื่อไฟล์ไม่ถูกต้อง");
  const r = await sb("POST", "object/sign/" + enc(bucket) + "/" + enc(path), { json: { expiresIn } });
  const u = r && (r.signedURL || r.signedUrl);
  if (!u) throw new Error("Supabase ไม่ส่งลิงก์ดาวน์โหลดกลับมา");
  return /^https:\/\//.test(u) ? u : cfg().url + "/storage/v1" + (u.startsWith("/") ? u : "/" + u);
}

// ===== รูป (bucket สาธารณะ) =====
const EXT = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const publicBase = () => { const c = cfg(); return c.url + "/storage/v1/object/public/" + enc(c.bucket) + "/"; };
export const publicUrl = (path) => publicBase() + enc(path);
// path ในbucket รูปของเรา (หรือ "" ถ้าไม่ใช่ลิงก์ของเรา)
export function pathOf(url) {
  if (!storeReady() || typeof url !== "string" || !url.startsWith(publicBase())) return "";
  let p = url.slice(publicBase().length).split(/[?#]/)[0];
  try { p = decodeURIComponent(p); } catch { return ""; }
  return okPath(p) ? p : "";
}
export const isStoredUrl = (url) => !!pathOf(url);

// data URL → อัปขึ้น Supabase → ลิงก์ https สาธารณะ
//   ชื่อไฟล์ = <keyPrefix>-<sha256 16 ตัว>.<นามสกุล> (รูปเดิมได้ชื่อเดิม → อัปซ้ำได้ไม่เปลืองที่)
export async function putImage(dataUrl, keyPrefix) {
  const p = parseDataUrl(dataUrl);
  if (!p || !p.buf.length) throw new Error("ไฟล์รูปไม่ถูกต้อง");
  const type = p.type.toLowerCase() === "image/jpg" ? "image/jpeg" : p.type.toLowerCase();
  const ext = EXT[type];
  if (!ext) throw new Error("รองรับเฉพาะรูป JPG / PNG / WEBP / GIF");
  const key = String(keyPrefix || "img").replace(/[^A-Za-z0-9._/-]/g, "").replace(/\/+/g, "/").replace(/^\/|\/$/g, "") || "img";
  const path = key + "-" + crypto.createHash("sha256").update(p.buf).digest("hex").slice(0, 16) + "." + ext;
  await putObject(cfg().bucket, path, p.buf, type, { cache: "max-age=31536000" });
  return publicUrl(path);
}

// แปลงฟิลด์รูปใน obj ที่เป็น data URL → ลิงก์ Supabase (ไม่ได้ตั้งค่า = ไม่ทำอะไร เก็บ data URL เหมือนเดิม)
export async function storeImageFields(obj, fields, keyPrefix) {
  if (!obj || !storeReady()) return 0;
  const done = new Map(); let n = 0;
  const one = async (v) => {
    if (!isDataImg(v)) return v;
    if (!done.has(v)) { done.set(v, await putImage(v, keyPrefix)); n++; }
    return done.get(v);
  };
  for (const f of fields) {
    const v = obj[f];
    if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await one(x)); obj[f] = out; }
    else if (isDataImg(v)) obj[f] = await one(v);
  }
  return n;
}
// ลิงก์รูปทั้งหมดในเอกสาร (รวม array)
export const imageUrlsOf = (doc, fields) => (doc ? fields.flatMap((f) => (Array.isArray(doc[f]) ? doc[f] : [doc[f]])).filter((x) => typeof x === "string" && x) : []);

// ลบไฟล์รูปของเราตามลิงก์ (ทำเท่าที่ได้ — ไม่ throw) · scope = โฟลเดอร์ที่อนุญาตให้ลบ เช่น "h/<hotelId>"
// (กันเจ้าของที่พักหนึ่งเอาลิงก์รูปของที่พักอื่นมาใส่แล้วกดลบ)
export async function removeByUrl(url, scope = "") {
  const p = pathOf(url);
  if (!p || (scope && !p.startsWith(String(scope).replace(/\/+$/, "") + "/"))) return false;
  try { await sb("DELETE", "object/" + enc(cfg().bucket) + "/" + enc(p), { timeout: 10000 }); return true; }
  catch (e) { console.warn("filestore remove:", e.message); return false; }
}
// ลบรูปที่เคยใช้ (before) แต่ไม่อยู่ในชุดใหม่ (keep)
export async function dropImages(before, keep = [], scope = "") {
  const k = new Set(keep.filter(Boolean));
  let n = 0;
  for (const u of new Set(before.filter(Boolean))) if (!k.has(u) && await removeByUrl(u, scope)) n++;
  return n;
}
// ลบทุกไฟล์ในโฟลเดอร์ (เช่น ตอนลบที่พักถาวร) — ทำเท่าที่ได้
export async function removePrefix(prefix) {
  if (!storeReady() || !okPath(prefix)) return 0;
  try {
    const files = await listObjects(cfg().bucket, prefix);
    return await removePaths(cfg().bucket, files.map((f) => prefix + "/" + f.name));
  } catch (e) { console.warn("filestore removePrefix:", e.message); return 0; }
}
