// lib/mongodb.ts
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_WA_API_DB;

if (!MONGO_URI) {
  throw new Error("❌ Please define MONGO_WA_API_DB in .env");
}

const cached = globalThis.mongooseCache ?? {
  conn: null,
  promise: null,
};

globalThis.mongooseCache = cached;

export default async function connectDB() {
  // Return existing connection if available
  if (cached.conn?.readyState === 1) {
    return cached.conn;
  }

  // Create new connection promise if none exists
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGO_URI)
      .then((mongoose) => {
        return mongoose.connection;
      })
      .catch((error) => {
        cached.promise = null; // Reset promise on error
        throw error;
      });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    cached.promise = null; // Reset promise on error
    throw error;
  }
}

// Optional: Graceful shutdown
export async function disconnectDB() {
  if (cached.conn) {
    await mongoose.disconnect();
    cached.conn = null;
    cached.promise = null;
  }
}

// Connection event listeners (optional but useful for debugging)
if (mongoose.connection) {
  mongoose.connection.on("connected", () => {
    console.log("✅ Mongoose connected to MongoDB");
  });

  mongoose.connection.on("error", (err) => {
    console.error("❌ Mongoose connection error:", err);
  });

  mongoose.connection.on("disconnected", () => {
    console.log("📡 Mongoose disconnected from MongoDB");
  });
}
