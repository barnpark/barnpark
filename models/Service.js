import mongoose from "mongoose";

const schema = new mongoose.Schema({
  hotel:       { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  name:        String,
  description: String,
  price:       Number,
  imageUrl:    String,
  sort:        { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model("Service", schema);
