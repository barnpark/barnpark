import mongoose from "mongoose";

// แขก 1 คนที่ทักเข้า LINE OA ของโรงแรม 1 ที่ — จำว่ากำลังจองถึงขั้นไหน
// (แยกจาก LineChat ซึ่งเป็นเจ้าของที่พักใน LINE Barn Park — userId ของ OA คนละตัวอาจซ้ำกันได้ จึงผูกกับโรงแรมด้วย)
const schema = new mongoose.Schema({
  hotel:      { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true },
  userId:     { type: String, required: true },
  name:       String,                          // ชื่อที่แสดงใน LINE (ใช้เป็นค่าตั้งต้นชื่อผู้จอง)
  flow:       { type: String, default: "" },
  step:       { type: String, default: "" },
  data:       { type: mongoose.Schema.Types.Mixed, default: {} },
  flowAt:     Date,
  lastNudgeAt: Date,                           // กันบอทตอบข้อความทั่วไปรัว ๆ (ให้ทีมที่พักคุยกับแขกเองได้)
}, { timestamps: true });

schema.index({ hotel: 1, userId: 1 }, { unique: true });

export default mongoose.model("GuestChat", schema);
