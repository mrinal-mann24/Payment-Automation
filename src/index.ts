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
    const cycleDealIds = new Set(
      classified.deals.filter((deal) => isBilledByCycles(deal.classification)).map((deal) => deal.dealId),
    );
    await runBillingCycleCheck(classified).catch((err) => {
      console.error("[billingCycle] run failed:", err);
    });
    await runRenewalCheck(cycleDealIds, now).catch((err) => {
      console.error("[renewalCron] run failed:", err);
    });
  }

  await runSettlementSweep().catch((err) => {
    console.error("[settlementSweep] run failed:", err);
  });

  await runOverdueReminderCheck(now).catch((err) => {
    console.error("[reminderCron] run failed:", err);
  });
}, { timezone: "Asia/Kolkata", noOverlap: true });
