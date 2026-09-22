import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEstimate } from "../clients/zoho.js";

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.ZOHO_CLIENT_ID = "client-id";
  process.env.ZOHO_CLIENT_SECRET = "client-secret";
  process.env.ZOHO_REFRESH_TOKEN = "refresh-token";
  process.env.ZOHO_ORG_ID = "org-1";
});

afterEach(() => {
  global.fetch = originalFetch;
});

// Routes the OAuth refresh to a canned token and captures the /estimates body.
function mockZohoFetch(): { body?: Record<string, unknown> } {
  const captured: { body?: Record<string, unknown> } = {};
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path.startsWith("https://accounts.zoho.in/")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    if (path.includes("/estimates?")) {
      captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ estimate: { estimate_id: "zest-1", estimate_number: "QT-1", total: 5400 } }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${path}`);
  }) as unknown as typeof fetch;
  return captured;
}

const deal = {
  dealId: "deal-1",
  dealName: "Acme <> VA",
  billingPeriod: null,
  contactEmail: "client@example.com",
  contactName: "Client Name",
  contactPhone: null,
  lineItems: [{ id: "li-1", name: "Service", quantity: 2, price: 5000 }],
};

describe("createEstimate", () => {
  it("bills a monthly cycle as one bold Virtual Accounting line with the service period as its description", async () => {
    const captured = mockZohoFetch();

    const result = await createEstimate("zcust-1", deal, {
      key: "2026-10",
      narration: "Service period: 1 October 2026 to 31 October 2026",
    });

    expect(result).toEqual({ estimateId: "zest-1", estimateNumber: "QT-1", total: 5400 });
    expect(captured.body).toMatchObject({
      customer_id: "zcust-1",
      reference_number: "deal-1/2026-10",
      line_items: [
        {
          name: "Virtual Accounting",
          description: "Service period: 1 October 2026 to 31 October 2026",
          rate: 5000,
          quantity: 1,
          tax_id: "2273874000000030203",
          tds_tax_id: "2273874000000527020",
        },
      ],
    });
  });

  it("keeps the legacy payload unchanged when no cycle is given", async () => {
    const captured = mockZohoFetch();

    await createEstimate("zcust-1", deal);

    expect(captured.body).toMatchObject({ reference_number: "deal-1" });
    const lineItem = (captured.body!.line_items as Array<Record<string, unknown>>)[0]!;
    expect(lineItem).toMatchObject({ name: "Service", rate: 5000, quantity: 2 });
    expect(lineItem).not.toHaveProperty("description");
  });
});
