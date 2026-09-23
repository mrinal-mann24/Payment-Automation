import { describe, expect, it } from "vitest";
import { needsRedelivery } from "../routes/razorpayWebhook.js";

describe("needsRedelivery", () => {
  it("asks Razorpay to redeliver only for outstanding steps the daily sweep does not own", () => {
    expect(needsRedelivery([])).toBe(false);
    expect(needsRedelivery(["zoho payment: Zoho Books API error 403: no permission"])).toBe(false);
    expect(needsRedelivery(["invoice: Zoho Books API error 500"])).toBe(true);
    expect(needsRedelivery(["zoho payment: 403", "email: Zoho down"])).toBe(true);
  });
});
