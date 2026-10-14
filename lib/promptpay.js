// ===== PromptPay QR (มาตรฐาน EMVCo / Thai QR) =====
// อัลกอริทึมเดียวกับไลบรารีอ้างอิง promptpay-qr (ทดสอบเทียบแล้ว)
// สำคัญ: AID ของ PromptPay โอนเงินคือ A000000677010111 (ถ้าใช้ค่าอื่น แอปธนาคารจะสแกนไม่ขึ้น)
const AID_PROMPTPAY = "A000000677010111";

const field = (id, value) => id + String(value.length).padStart(2, "0") + value;

function crc16(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// แปลงค่าที่ผู้ใช้กรอกเป็นตัวเลขล้วน + ตรวจรูปแบบ: เบอร์มือถือ 10 หลัก / เลขบัตร ปชช.-นิติบุคคล 13 หลัก / e-Wallet 15 หลัก
export function normalizePromptPayId(input) {
  let d = String(input || "").replace(/[๐-๙]/g, (c) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(c))).replace(/\D/g, "");
  if (d.startsWith("66") && d.length === 11) d = "0" + d.slice(2); // +66 8x → 08x
  if ((d.length === 10 && d.startsWith("0")) || d.length === 13 || d.length === 15) return d;
  return null;
}

export function promptPayPayload(target, amount) {
  const id = String(target || "").replace(/\D/g, "");
  if (!id) return "";
  const type = id.length >= 15 ? "03" : id.length >= 13 ? "02" : "01";
  const formatted = id.length >= 13 ? id : ("0000000000000" + id.replace(/^0/, "66")).slice(-13);
  const amt = Number(amount) > 0 ? Number(amount) : 0;
  const data = [
    field("00", "01"),
    field("01", amt ? "12" : "11"),
    field("29", field("00", AID_PROMPTPAY) + field(type, formatted)),
    field("58", "TH"),
    field("53", "764"),
    amt ? field("54", amt.toFixed(2)) : "",
  ].join("");
  const withCrcTag = data + "6304";
  return withCrcTag + crc16(withCrcTag);
}

// แสดงเลขแบบอ่านง่าย 081-234-5678 / 1-2345-67890-12-3
export function formatPromptPayId(id) {
  const d = String(id || "").replace(/\D/g, "");
  if (d.length === 10) return d.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
  if (d.length === 13) return d.replace(/(\d)(\d{4})(\d{5})(\d{2})(\d)/, "$1-$2-$3-$4-$5");
  return d;
}
