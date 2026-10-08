// ราคาตามฤดู/ช่วงพิเศษ — ใช้ราคาของช่วงที่ "วันเช็คอิน" ตกอยู่ (ไม่ตกช่วง = basePrice)
export function rateFor(rt, checkin) {
  for (const s of (rt.seasons || [])) {
    if (s.from && s.to && checkin >= s.from && checkin <= s.to) {
      return { price: (s.price != null ? s.price : rt.basePrice), minNights: s.minNights || 0, season: s.name || "" };
    }
  }
  return { price: rt.basePrice, minNights: 0, season: "" };
}
