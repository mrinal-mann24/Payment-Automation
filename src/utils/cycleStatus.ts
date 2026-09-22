import type { RenewalJob } from "../repositories/renewalJobs.js";

export type CycleStatus = "unpaid" | "payment_pending" | "paid";

// PAID is defined by paid_at alone (set by every payment route: Razorpay,
// Yes Bank, manual entry); PAYMENT PENDING means the quote and link are
// out; UNPAID is anything before that.
export function deriveCycleStatus(job: Pick<RenewalJob, "paid_at" | "razorpay_step_status">): CycleStatus {
  if (job.paid_at) {
    return "paid";
  }
  if (job.razorpay_step_status === "done") {
    return "payment_pending";
  }
  return "unpaid";
}
