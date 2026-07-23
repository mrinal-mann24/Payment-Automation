import "dotenv/config";
import cron from "node-cron";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { runRenewalCheck } from "./jobs/renewalCron.js";
import { runOverdueReminderCheck } from "./jobs/reminderCron.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`Renewal automation service listening on port ${config.port}`);
});

cron.schedule("0 6 * * *", async () => {
  await runRenewalCheck().catch((err) => {
    console.error("[renewalCron] run failed:", err);
  });
  await runOverdueReminderCheck().catch((err) => {
    console.error("[reminderCron] run failed:", err);
  });
}, { timezone: "Asia/Kolkata" });
