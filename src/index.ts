import "dotenv/config";
import cron from "node-cron";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { classifyVaDeals, runMonthlyBillingCheck, type ClassifiedVaDeals } from "./jobs/monthlyBillingCron.js";
import { runRenewalCheck } from "./jobs/renewalCron.js";
import { runSettlementSweep } from "./jobs/settlementSweep.js";
import { runOverdueReminderCheck } from "./jobs/reminderCron.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`Renewal automation service listening on port ${config.port}`);
});

// One daily tick at 11:00 IST. The VA deals are classified once and the
// result feeds both billing jobs, so they can never disagree about which
// deals are monthly; if classification fails, neither job bills anything
// this tick (fail closed). noOverlap keeps a slow run from being re-entered.
cron.schedule("0 11 * * *", async () => {
  const now = new Date();

  let classified: ClassifiedVaDeals | undefined;
  try {
    classified = await classifyVaDeals(now);
  } catch (err) {
    console.error("[monthlyBilling] classification failed, skipping monthly and legacy billing this tick:", err);
  }

  if (classified) {
    const monthlyDealIds = new Set(
      classified.deals.filter((deal) => deal.classification.monthly).map((deal) => deal.dealId),
    );
    await runMonthlyBillingCheck(classified).catch((err) => {
      console.error("[monthlyBilling] run failed:", err);
    });
    await runRenewalCheck(monthlyDealIds, now).catch((err) => {
      console.error("[renewalCron] run failed:", err);
    });
  }

  await runSettlementSweep().catch((err) => {
    console.error("[settlementSweep] run failed:", err);
  });

  // Reminders disabled for now — do not send to clients until re-enabled.
  // await runOverdueReminderCheck().catch((err) => {
  //   console.error("[reminderCron] run failed:", err);
  // });
}, { timezone: "Asia/Kolkata", noOverlap: true });
