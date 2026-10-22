import mongoose from "mongoose";

// งานแก้เว็บที่ทีมสั่งผ่าน LINE Barn Park ("งาน: …") → ส่งให้ Claude Code บน GitHub Actions
// Claude Code แก้โค้ดในสาขาแยก + เปิด Pull Request + ทำไฟล์ zip — ไม่แตะเว็บจริงจนกว่าจะกด Merge เอง
const schema = new mongoose.Schema({
  no:         { type: Number, required: true, unique: true }, // หมายเลขงาน (#12)
  text:       { type: String, required: true },               // งานที่สั่ง
  by:         { type: String, required: true, index: true },  // LINE userId ผู้สั่ง
  byName:     { type: String, default: "" },
  // queued → sent (ส่งให้ GitHub แล้ว) → running → done | nochange | failed
  status:     { type: String, default: "queued" },
  summary:    { type: String, default: "" },                  // สรุปจาก Claude Code (ไทย)
  prUrl:      { type: String, default: "" },                  // Pull Request ให้ตรวจ/merge
  runUrl:     { type: String, default: "" },                  // หน้ารันบน GitHub (มีไฟล์ zip)
  tests:      { type: String, default: "" },                  // success | failure | skipped
  error:      { type: String, default: "" },
  finishedAt: Date,
}, { timestamps: true });

export default mongoose.model("DevJob", schema);
