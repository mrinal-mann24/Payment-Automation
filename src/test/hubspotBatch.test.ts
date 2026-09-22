import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchVaDealsWithLineItems } from "../clients/hubspot.js";

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = "test-token";
});

afterEach(() => {
  global.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fullItemProperties = {
  name: "VA Monthly",
  quantity: "1",
  price: "5000",
  recurringbillingfrequency: "monthly",
  hs_recurring_billing_period: "P1M",
  hs_recurring_billing_start_date: "2026-09-01",
  billing_term_end_date: "1790812800000",
  recurring_revenue_type: "Renewal",
  hs_product_id: "285430818522",
};

describe("fetchVaDealsWithLineItems", () => {
  it("reads line items in batches of at most 100 and treats a deal missing from the associations result as having none", async () => {
    const lineItemIds = Array.from({ length: 120 }, (_, i) => 900000 + i);
    const batchReadCalls: Array<{ inputs: Array<{ id: string }> }> = [];

    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/crm/v3/objects/deals/search")) {
        return jsonResponse({
          results: [
            { id: "d1", properties: { dealname: "One <> VA", dealstage: "3102360263", billing_cycle: "Monthly" } },
            { id: "d2", properties: { dealname: "Two <> VA", dealstage: "2462646003", billing_cycle: null } },
          ],
        });
      }
      if (path.endsWith("/crm/v4/associations/deals/line_items/batch/read")) {
        return jsonResponse(
          { results: [{ from: { id: "d1" }, to: lineItemIds.map((id) => ({ toObjectId: id })) }] },
          207,
        );
      }
      if (path.endsWith("/crm/v3/objects/line_items/batch/read")) {
        const body = JSON.parse(String(init?.body)) as { inputs: Array<{ id: string }> };
        batchReadCalls.push(body);
        return jsonResponse({
          results: body.inputs.map(({ id }) => ({ id, properties: fullItemProperties })),
        });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    }) as unknown as typeof fetch;

    const deals = await fetchVaDealsWithLineItems();

    expect(batchReadCalls.map((c) => c.inputs.length)).toEqual([100, 20]);
    expect(deals.map((d) => [d.dealId, d.billingCycle, d.lineItems.length])).toEqual([
      ["d1", "Monthly", 120],
      ["d2", null, 0],
    ]);
    expect(deals[0]!.lineItems[0]).toMatchObject({
      id: "900000",
      price: 5000,
      recurringBillingFrequency: "monthly",
      billingPeriodTerm: "P1M",
      billingStartDate: "2026-09-01",
      billingTermEndDate: "2026-10-01",
      recurringRevenueType: "Renewal",
      productId: "285430818522",
    });
  });

  it("records a per-deal error instead of failing the whole listing when a line item is malformed", async () => {
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/deals/search")) {
        return jsonResponse({
          results: [{ id: "d1", properties: { dealname: "One", dealstage: "x", billing_cycle: "Monthly" } }],
        });
      }
      if (path.includes("/associations/")) {
        return jsonResponse({ results: [{ from: { id: "d1" }, to: [{ toObjectId: 1 }] }] });
      }
      return jsonResponse({ results: [{ id: "1", properties: { name: "Bad", quantity: "1", price: "abc" } }] });
    }) as unknown as typeof fetch;

    const [deal] = await fetchVaDealsWithLineItems();

    expect(deal!.lineItems).toEqual([]);
    expect(deal!.lineItemsError).toMatch(/invalid price/);
  });
});
