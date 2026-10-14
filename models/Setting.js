import mongoose from "mongoose";

// ค่าตั้งของแพลตฟอร์มแบบ key/value (เช่น richMenuId ของ LINE OA Barn Park)
const schema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

export default mongoose.model("Setting", schema);
