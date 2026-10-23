// ===== ล้างแคชแผนที่หน้าแรก (lib/geo.js) ทันทีเมื่อข้อมูลที่พัก/ห้องเปลี่ยน =====
// แยกไฟล์ไว้ให้ models/*.js เรียกได้โดยไม่ import วนกับ lib/geo.js
let version = 0;
export const mapVersion = () => version;
export const bumpMap = () => { version++; };

// ผูก middleware กับ schema: ทุกการบันทึก/แก้/ลบ → ล้างแคช · ยกเว้นการอัปเดตที่แตะแค่ฟิลด์ใน `ignore` (เช่น geo ที่ geo.js บันทึกเอง)
export function bumpMapOnChange(schema, ignore = []) {
  const onlyIgnored = (u) => {
    if (!u || !ignore.length) return false;
    const keys = Object.keys(u).flatMap((k) => (k[0] === "$" ? Object.keys(u[k] || {}) : [k]));
    return keys.length > 0 && keys.every((k) => ignore.includes(k.split(".")[0]));
  };
  schema.post("save", bumpMap);
  schema.post(["deleteOne", "deleteMany", "findOneAndDelete"], bumpMap);
  schema.post(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"], function () { if (!onlyIgnored(this.getUpdate())) bumpMap(); });
  schema.post("deleteOne", { document: true, query: false }, bumpMap);
}
