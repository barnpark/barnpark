// ===== จองกิจกรรมเดี่ยว (ไม่ต้องพัก) — ใช้ร่วมกันทั้งหน้าเว็บแขกและบอท LINE =====
import ActivityBooking from "../models/ActivityBooking.js";

export const sellsStandalone = (s) => s && !s.hidden && (s.saleMode === "standalone" || s.saleMode === "both");
export const sellsAddon = (s) => s && (s.saleMode || "addon") !== "standalone";
export const TIME_RE = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/;
export const normTime = (t) => { const m = TIME_RE.exec(String(t || "").trim()); return m ? m[1].padStart(2, "0") + ":" + m[2] : null; };

// จำนวนที่ถูกจองแล้ว ในวัน (และรอบ) นั้น
export async function bookedQty(serviceId, date, time = "") {
  const q = { service: serviceId, date, status: { $ne: "cancelled" } };
  if (time) q.time = time;
  const list = await ActivityBooking.find(q).select("qty").lean();
  return list.reduce((s, b) => s + (b.qty || 1), 0);
}

// ที่ว่างคงเหลือ: { unlimited, slots:[{time,left}] } หรือ { left }
export async function availability(svc, date) {
  const cap = svc.dailyCap || 0;
  const times = svc.times || [];
  if (times.length) {
    const slots = [];
    for (const t of times) slots.push({ time: t, left: cap ? Math.max(0, cap - (await bookedQty(svc._id, date, t))) : null });
    return { unlimited: !cap, slots };
  }
  return { unlimited: !cap, left: cap ? Math.max(0, cap - (await bookedQty(svc._id, date))) : null };
}

import { mkRef } from "./security.js";
export const mkActRef = () => mkRef("BA");

// สร้างการจองกิจกรรม (ตรวจรอบ/ที่ว่าง + กันจองเกินแบบตรวจซ้ำหลังบันทึก)
export async function createActivityBooking(hotel, svc, { date, time = "", qty = 1, name, tel, email = "", note = "", channel = "direct", paid = false, payRef = "", payStatus } = {}) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || date < today) throw Object.assign(new Error("วันที่ไม่ถูกต้อง"), { status: 400 });
  const n = Math.max(1, Math.min(50, parseInt(qty, 10) || 1));
  let tm = "";
  if ((svc.times || []).length) {
    tm = normTime(time) || "";
    if (!svc.times.includes(tm)) throw Object.assign(new Error("กรุณาเลือกรอบเวลา"), { status: 400 });
  }
  const cap = svc.dailyCap || 0;
  if (cap && (await bookedQty(svc._id, date, tm)) + n > cap) throw Object.assign(new Error("รอบนี้เต็มแล้ว กรุณาเลือกวัน/รอบอื่น"), { status: 409 });
  const b = await ActivityBooking.create({
    hotel: hotel._id, service: svc._id, serviceName: svc.name, date, time: tm, qty: n, amount: (svc.price || 0) * n,
    guestName: String(name || "").trim(), guestTel: String(tel || "").trim(), guestEmail: String(email || "").trim(), note,
    channel, status: "confirmed", payStatus: payStatus || (paid ? "reported" : "unpaid"), payRef: payRef || "",
    payMethod: paid ? "promptpay" : "", ref: mkActRef(),
  });
  if (cap && (await bookedQty(svc._id, date, tm)) > cap) {
    await ActivityBooking.deleteOne({ _id: b._id });
    throw Object.assign(new Error("ขออภัย รอบนี้เพิ่งเต็มพอดี"), { status: 409 });
  }
  return b;
}
