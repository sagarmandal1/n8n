import subscriptionCron from "./subscription.cron.js";
import cleanupCron from "./cleanup.cron.js";
// import analyticsCron from "./analytics.cron.js";

const startCrons = () => {
  console.log("🕒 Initializing cron jobs...");

  subscriptionCron();
  cleanupCron();
  // analyticsCron();

  console.log("✅ All cron jobs loaded");
};

export default startCrons;
