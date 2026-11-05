const mongoose = require("mongoose");

/**
 * Connect to MongoDB database.
 */
const connectDB = async () => {
  try {
    const connection = await mongoose.connect(process.env.MONGO_URI);

    console.log(
      `MongoDB Connected: ${connection.connection.host}`
    );

    console.log(
      `Database Name: ${connection.connection.name}`
    );
  } catch (error) {
    console.error("MongoDB Connection Failed:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;