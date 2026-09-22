import { describe, expect, it } from "vitest";
import { deriveCycleStatus } from "../utils/cycleStatus.js";

describe("deriveCycleStatus", () => {
  it("is PAID whenever paid_at is set, PAYMENT PENDING once the link is out, UNPAID before that", () => {
    expect(deriveCycleStatus({ paid_at: "2026-10-03T04:00:00Z", razorpay_step_status: "done" })).toBe("paid");
    expect(deriveCycleStatus({ paid_at: "2026-10-03T04:00:00Z", razorpay_step_status: "failed" })).toBe("paid");
    expect(deriveCycleStatus({ paid_at: null, razorpay_step_status: "done" })).toBe("payment_pending");
    expect(deriveCycleStatus({ paid_at: null, razorpay_step_status: "pending" })).toBe("unpaid");
    expect(deriveCycleStatus({ paid_at: null, razorpay_step_status: "failed" })).toBe("unpaid");
  });
});
