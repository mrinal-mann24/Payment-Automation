import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenewalLineItem } from "../clients/hubspot.js";

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = "test-token";
});

afterEach(() => {
  global.fetch = originalFetch;
});

function captureLineItemCreate(): { body?: { properties: Record<string, string> } } {
  const captured: { body?: { properties: Record<string, string> } } = {};
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/crm/v3/objects/line_items")) {
      captured.body = JSON.parse(String(init?.body)) as { properties: Record<string, string> };
      return new Response(JSON.stringify({ id: "li-new" }), { status: 201 });
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  }) as unknown as typeof fetch;
  return captured;
}

const input = {
  name: "Bookkeeping + GST + TDS Services VA",
  price: 39000,
  productId: "prod-1",
  billingStartDate: "2026-10-09",
  datePaid: "2026-10-10",
};

describe("createRenewalLineItem", () => {
  it("writes the term as HubSpot's frequency + period so the next due date is computed the way the team enters it", async () => {
    const expectations: Array<[number, string, string]> = [
      [1, "monthly", "P1M"],
      [3, "quarterly", "P3M"],
      [6, "per_six_months", "P6M"],
    ];
    for (const [months, frequency, period] of expectations) {
      const captured = captureLineItemCreate();

      const id = await createRenewalLineItem("deal-1", { ...input, months });

      expect(id).toBe("li-new");
      expect(captured.body!.properties).toMatchObject({
        name: input.name,
        quantity: "1",
        price: "39000",
        recurringbillingfrequency: frequency,
        hs_recurring_billing_period: period,
        hs_recurring_billing_start_date: "2026-10-09",
        date_renewed: "2026-10-10",
        recurring_revenue_type: "Renewal",
        hs_product_id: "prod-1",
      });
    }
  });
});
