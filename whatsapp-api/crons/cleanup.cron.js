import cron from "node-cron";
import fs from "fs-extra";
import path from "path";

const cleanupCron = () => {
  // Run every hour
  cron.schedule("0 * * * *", async () => {
    try {
      const dirsToClean = [
        path.join(process.cwd(), "public", "received_media"),
        path.join(process.cwd(), "public", "uploads")
      ];

      for (const dirPath of dirsToClean) {
        if (!fs.existsSync(dirPath)) continue;

        const files = await fs.readdir(dirPath);
        const now = Date.now();
        const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

        for (const file of files) {
          if (file === ".gitkeep") continue;
          const filePath = path.join(dirPath, file);
          const stats = await fs.stat(filePath);

          if (now - stats.mtimeMs > MAX_AGE) {
            await fs.unlink(filePath);
          }
        }
      }
      console.log("🧹 Media Cleanup Cron: Removed files older than 24 hours.");
    } catch (error) {
      console.error("Cron Cleanup Error:", error);
    }
  });
};

export default cleanupCron;
