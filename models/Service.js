import mongoose from "mongoose";

const schema = new mongoose.Schema({
  hotel:       { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  name:        String,
  description: String,
  price:       Number,
  imageUrl:    String,
  hidden:      { type: Boolean, default: false }, // ปิดขายชั่วคราว
  sort:        { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model("Service", schema);
