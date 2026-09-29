import mongoose from "mongoose";

const schema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, select: false },
  role:         { type: String, enum: ["owner", "staff", "admin"], default: "staff" },
  hotel:        { type: mongoose.Schema.Types.ObjectId, ref: "Hotel" }, // null สำหรับ admin
  name:         String,
}, { timestamps: true });

export default mongoose.model("User", schema);
