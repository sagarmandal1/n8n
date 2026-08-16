import mongoose from "mongoose";
import AutoReply from "./models/autoReplyModel.js";
import 'dotenv/config';

async function run() {
  await mongoose.connect(process.env.MONGO_WA_API_DB);
  const rules = await AutoReply.find({});
  for(let r of rules) {
    console.log(`SESSION: ${r.session} | KEYWORD: ${r.keyword} | MATCH: ${r.matchType}`);
  }
  process.exit(0);
}
run();
