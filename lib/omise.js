// ===== เตรียมรับชำระด้วยบัตรเครดิต ผ่าน Omise (เกตเวย์ไทย) =====
// ยังไม่เปิดใช้งานจนกว่าจะตั้ง env OMISE_SECRET_KEY + OMISE_PUBLIC_KEY (ต้องสมัคร Omise ก่อน)
// เอกสาร: https://docs.opn.ooo  · ฝั่งหน้าเว็บใช้ Omise.js สร้าง token จากบัตร แล้วส่ง token มา charge ที่นี่
const SECRET = process.env.OMISE_SECRET_KEY || "";

export function omiseReady() { return !!SECRET; }

// สร้างรายการชำระจาก token ของบัตร (ยังไม่เปิดใช้งาน — โครงไว้ต่อภายหลัง)
export async function charge(amountBaht, token, desc) {
  if (!SECRET) throw new Error("OMISE_SECRET_KEY ยังไม่ได้ตั้ง — ยังไม่เปิดรับบัตรเครดิต");
  const body = new URLSearchParams({ amount: String(Math.round(amountBaht * 100)), currency: "thb", card: token, description: desc || "BARN-PARK booking" });
  const r = await fetch("https://api.omise.co/charges", {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(SECRET + ":").toString("base64"), "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const d = await r.json();
  if (!r.ok || d.object === "error") throw new Error("omise " + (d.message || r.status));
  return { ok: d.paid === true, id: d.id, status: d.status };
}
