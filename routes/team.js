// ===== ทีมงานและรหัสพนักงาน (lib/team.js) + ประวัติการทำงาน =====
// เพิ่ม/แก้/ลบคนในทีม = ต้องใช้รหัสผู้จัดการ (คนแรกของทีมต้องเป็นผู้จัดการ) · ห้ามลบ/ปิด/ลดสิทธิ์ผู้จัดการคนสุดท้าย
// ลืมรหัสผู้จัดการ → ใช้รหัสผ่านบัญชีเจ้าของที่พักตั้งรหัสใหม่ได้ (POST /hotels/:hid/team/recover)
import { Router } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import ActionLog from "../models/ActionLog.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { PERMS, ACTION_TH, cleanPerms, validPin, pinKey, pinReady, actor, logAction } from "../lib/team.js";

const r = Router();
const MAX_TEAM = 30;
const out = (s) => ({ id: s._id, name: s.name, manager: !!s.manager, perms: s.manager ? Object.keys(PERMS) : s.perms || [], active: s.active !== false, lastUsedAt: s.lastUsedAt || null });
const bad = (res, error, status = 400) => res.status(status).json({ error });
const PIN_HINT = "รหัสพนักงานเป็นตัวเลข 4–6 หลัก";
const noSecret = (res) => bad(res, "ระบบรหัสพนักงานยังไม่พร้อม — ต้องตั้ง JWT_SECRET (อย่างน้อย 16 ตัว) ใน Render ก่อน", 503);
const activeManagers = (hid, exceptId) => Staff.countDocuments({ hotel: hid, manager: true, active: true, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });

r.get("/team/perms", requireAuth, (_req, res) => res.json({ perms: PERMS, actions: ACTION_TH }));

// รายชื่อทีม (ไม่มีรหัส) — เครื่องของที่พักดูได้ ใช้แสดงชื่อ/สิทธิ์
r.get("/hotels/:hid/team", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return bad(res, "forbidden", 403);
  const list = await Staff.find({ hotel: req.params.hid }).sort({ manager: -1, createdAt: 1 }).lean();
  res.json({ ready: pinReady(), team: list.map(out) });
});

r.post("/hotels/:hid/team", requireAuth, async (req, res) => {
  const hid = req.params.hid;
  if (!canAccessHotel(req.user, hid)) return bad(res, "forbidden", 403);
  if (!pinReady()) return noSecret(res);
  const who = await actor(req, res, hid, "manager"); if (!who) return;
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 60);
  if (!name) return bad(res, "กรอกชื่อ");
  if (!validPin(b.pin)) return bad(res, PIN_HINT);
  if ((await Staff.countDocuments({ hotel: hid })) >= MAX_TEAM) return bad(res, `ทีมมีได้สูงสุด ${MAX_TEAM} คน`);
  let manager = b.manager === true || b.manager === "true";
  if (!(await activeManagers(hid)) && !manager) return bad(res, "คนแรกของทีมต้องเป็นผู้จัดการ (เพื่อให้มีคนจัดการทีมได้)");
  const key = pinKey(hid, b.pin);
  if (await Staff.findOne({ hotel: hid, pinKey: key })) return bad(res, "รหัสนี้มีคนใช้แล้ว — เลือกรหัสอื่น", 409);
  const s = await Staff.create({ hotel: hid, name, pinKey: key, manager, perms: manager ? [] : cleanPerms(b.perms), active: true });
  await logAction(hid, who, "team.create", name, manager ? "ผู้จัดการ" : cleanPerms(b.perms).join(", "));
  res.json(out(s));
});

async function memberOf(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { bad(res, "not found", 404); return null; }
  const s = await Staff.findById(req.params.id);
  if (!s) { bad(res, "ไม่พบคนนี้ในทีม", 404); return null; }
  if (!canAccessHotel(req.user, s.hotel)) { bad(res, "forbidden", 403); return null; }
  return s;
}

// แก้ชื่อ · รหัส · ผู้จัดการ · สิทธิ์ · เปิด/ปิด
r.patch("/team/:id", requireAuth, async (req, res) => {
  const s = await memberOf(req, res); if (!s) return;
  if (!pinReady()) return noSecret(res);
  const who = await actor(req, res, s.hotel, "manager"); if (!who) return;
  const b = req.body || {}, notes = [];
  if (b.name !== undefined) { const nm = String(b.name || "").trim().slice(0, 60); if (!nm) return bad(res, "กรอกชื่อ"); if (nm !== s.name) notes.push("ชื่อ"); s.name = nm; }
  if (b.pin !== undefined && b.pin !== "") {
    if (!validPin(b.pin)) return bad(res, PIN_HINT);
    const key = pinKey(s.hotel, b.pin);
    if (await Staff.findOne({ hotel: s.hotel, pinKey: key, _id: { $ne: s._id } })) return bad(res, "รหัสนี้มีคนใช้แล้ว — เลือกรหัสอื่น", 409);
    s.pinKey = key; notes.push("รหัส");
  }
  const nextManager = b.manager !== undefined ? b.manager === true || b.manager === "true" : s.manager;
  const nextActive = b.active !== undefined ? b.active === true || b.active === "true" : s.active !== false;
  if (s.manager && s.active !== false && (!nextManager || !nextActive) && !(await activeManagers(s.hotel, s._id))) return bad(res, "ต้องมีผู้จัดการที่ใช้งานอยู่อย่างน้อย 1 คน");
  if (nextManager !== !!s.manager) notes.push(nextManager ? "เป็นผู้จัดการ" : "ไม่เป็นผู้จัดการ");
  if (nextActive !== (s.active !== false)) notes.push(nextActive ? "เปิดรหัส" : "ปิดรหัส");
  s.manager = nextManager; s.active = nextActive;
  if (b.perms !== undefined) { s.perms = cleanPerms(b.perms); notes.push("สิทธิ์"); }
  if (s.manager) s.perms = [];
  await s.save();
  await logAction(s.hotel, who, "team.edit", s.name, notes.join(", "));
  res.json(out(s));
});

r.delete("/team/:id", requireAuth, async (req, res) => {
  const s = await memberOf(req, res); if (!s) return;
  const who = await actor(req, res, s.hotel, "manager"); if (!who) return;
  if (s.manager && s.active !== false && !(await activeManagers(s.hotel, s._id))) return bad(res, "ต้องมีผู้จัดการที่ใช้งานอยู่อย่างน้อย 1 คน");
  await Staff.deleteOne({ _id: s._id });
  await logAction(s.hotel, who, "team.delete", s.name);
  res.json({ ok: true });
});

// ลืมรหัสผู้จัดการ: ยืนยันด้วยรหัสผ่านบัญชีเจ้าของ (ที่ใช้เข้าระบบเครื่องนี้) แล้วตั้งรหัสใหม่ให้ผู้จัดการคนนั้น
r.post("/hotels/:hid/team/recover", requireAuth, async (req, res) => {
  const hid = req.params.hid;
  if (!canAccessHotel(req.user, hid) || req.user.role === "staff") return bad(res, "forbidden", 403);
  if (!pinReady()) return noSecret(res);
  const { password = "", id, pin } = req.body || {};
  const u = await User.findById(req.user.id).select("+passwordHash name email");
  if (!u || !u.passwordHash || !bcrypt.compareSync(String(password), u.passwordHash)) return bad(res, "รหัสผ่านบัญชีเจ้าของไม่ถูกต้อง", 403);
  if (!mongoose.isValidObjectId(id)) return bad(res, "เลือกผู้จัดการ");
  const s = await Staff.findOne({ _id: id, hotel: hid, manager: true });
  if (!s) return bad(res, "ไม่พบผู้จัดการคนนี้", 404);
  if (!validPin(pin)) return bad(res, PIN_HINT);
  const key = pinKey(hid, pin);
  if (await Staff.findOne({ hotel: hid, pinKey: key, _id: { $ne: s._id } })) return bad(res, "รหัสนี้มีคนใช้แล้ว — เลือกรหัสอื่น", 409);
  s.pinKey = key; s.active = true; await s.save();
  await logAction(hid, { name: "บัญชีเจ้าของ (" + (u.email || "") + ")" }, "team.recover", s.name);
  res.json(out(s));
});

// ประวัติการทำงาน — ดูได้ด้วยรหัสผู้จัดการ · กรองตามเลขจอง/ชื่อคน · หน้าละ 100 รายการ
r.get("/hotels/:hid/actions", requireAuth, async (req, res) => {
  const hid = req.params.hid;
  if (!canAccessHotel(req.user, hid)) return bad(res, "forbidden", 403);
  const who = await actor(req, res, hid, "manager"); if (!who) return;
  const q = { hotel: hid };
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 40);
  if (req.query.ref) q.ref = new RegExp("^" + esc(req.query.ref), "i");
  if (req.query.name) q.name = String(req.query.name).slice(0, 60);
  if (req.query.before && !isNaN(Date.parse(req.query.before))) q.createdAt = { $lt: new Date(req.query.before) };
  const list = await ActionLog.find(q).sort({ createdAt: -1 }).limit(100).lean();
  res.json(list.map((a) => ({ at: a.createdAt, name: a.name, action: a.action, label: ACTION_TH[a.action] || a.action, ref: a.ref || "", text: a.text || "" })));
});

export default r;
