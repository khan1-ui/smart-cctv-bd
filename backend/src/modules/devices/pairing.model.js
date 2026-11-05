
const mongoose = require("mongoose");

const pairingSchema = new mongoose.Schema(
  {
    codeHash: {
      type: String,
      required: true,
      select: false,
    },

    // Owner who generated this pairing code.
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    isUsed: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Automatically remove expired pairing records.
pairingSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

// Find pairing records by their owner.
pairingSchema.index({ ownerId: 1 });

module.exports = mongoose.model("Pairing", pairingSchema);
