import "dotenv/config";
import cron from "node-cron";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { classifyVaDeals, isBilledByCycles, runBillingCycleCheck, type ClassifiedVaDeals } from "./jobs/billingCycleCron.js";
import { runRenewalCheck } from "./jobs/renewalCron.js";
import { runSettlementSweep } from "./jobs/settlementSweep.js";
import { runOverdueReminderCheck } from "./jobs/reminderCron.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`Renewal automation service listening on port ${config.port}`);
});

// One daily tick at 11:00 IST. The VA deals are classified once and the
// result feeds both billing jobs, so they can never disagree about which
// deals the cycles own; if classification fails, neither job bills anything
// this tick (fail closed). noOverlap keeps a slow run from being re-entered.
cron.schedule("0 11 * * *", async () => {
  const now = new Date();

  let classified: ClassifiedVaDeals | undefined;
  try {
    classified = await classifyVaDeals(now);
  } catch (err) {
    console.error("[billingCycle] classification failed, skipping cycle and legacy billing this tick:", err);
  }

  if (classified) {
    // The legacy cron skips every deal a cycle owns and every deal the admin paused.
    const skipDealIds = new Set([
      ...classified.deals.filter((deal) => isBilledByCycles(deal.classification)).map((deal) => deal.dealId),
      ...classified.paused,
    ]);
    await runBillingCycleCheck(classified).catch((err) => {
      console.error("[billingCycle] run failed:", err);
    });
    await runRenewalCheck(skipDealIds, now).catch((err) => {
      console.error("[renewalCron] run failed:", err);
    });
  }

  await runSettlementSweep().catch((err) => {
    console.error("[settlementSweep] run failed:", err);
  });
}, { timezone: "Asia/Kolkata", noOverlap: true });

// Payment reminders go at 12:00 IST, an hour after the quotes (business
// decision 2026-10-05), on their own schedule so a long quote run (random
// gaps, up to ~40 minutes on the 1st) never delays or overlaps them.
cron.schedule("0 12 * * *", async () => {
  await runOverdueReminderCheck(new Date()).catch((err) => {
    console.error("[reminderCron] run failed:", err);
  });
}, { timezone: "Asia/Kolkata", noOverlap: true });
