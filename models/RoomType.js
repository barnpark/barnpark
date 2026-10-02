import mongoose from "mongoose";

const schema = new mongoose.Schema({
  hotel:         { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  name:          String,
  capacity:      { type: Number, default: 2 },
  qty:           { type: Number, default: 1 },
  basePrice:     { type: Number, default: 0 },
  otaPrice:      { type: Number, default: 0 },
  extraBedPrice: { type: Number, default: 0 },
  imageUrl:      String,                 // รูปหลัก (เท่ากับ images[0]) — เก็บไว้เพื่อความเข้ากันได้
  images:        { type: [String], default: [] }, // แกลเลอรีสูงสุด 4 รูป
  sort:          { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model("RoomType", schema);
