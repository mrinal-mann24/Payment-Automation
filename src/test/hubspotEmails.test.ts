import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDealWithLineItemsAndContact,
  fetchVaDealEmails,
  updateDealBillingPocEmail,
} from "../clients/hubspot.js";

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

// A deal with (optionally) one associated contact and no line items.
function mockDealFetch(opts: { pocEmail?: string | null; pocName?: string | null; contact: { email?: string; phone?: string } | null }) {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path.includes("/crm/v3/objects/deals/deal-1?")) {
      return jsonResponse({
        id: "deal-1",
        properties: {
          dealname: "Acme <> VA",
          billing_cycle: "Monthly",
          next_renewal_date: "2026-10-01",
          billing_poc_email: opts.pocEmail ?? null,
          billing_poc_name: opts.pocName ?? null,
        },
        associations: opts.contact ? { contacts: { results: [{ id: "c-1" }] } } : {},
      });
    }
    if (path.includes("/crm/v3/objects/contacts/c-1")) {
      return jsonResponse({ id: "c-1", properties: { firstname: "Client", lastname: "Name", ...opts.contact } });
    }
    if (path.endsWith("/crm/v3/objects/deals/deal-1") && init?.method === "PATCH") {
      return jsonResponse({ id: "deal-1" });
    }
    throw new Error(`Unexpected fetch: ${path}`);
  }) as unknown as typeof fetch;
  return calls;
}

describe("fetchDealWithLineItemsAndContact — billing email", () => {
  it("sends to the deal's Billing POC Email when it is a real address, keeping the contact as the Zoho identity", async () => {
    mockDealFetch({ pocEmail: "accounts@acme.example", contact: { email: "owner@acme.example", phone: "9876543210" } });

    const deal = await fetchDealWithLineItemsAndContact("deal-1");

    expect(deal.billingEmail).toBe("accounts@acme.example");
    expect(deal.contactEmail).toBe("owner@acme.example");
    expect(deal.contactName).toBe("Client Name");
  });

  it("falls back to the contact's email when the POC field is blank or not an email (the live 'NA', '--' and phone-number values)", async () => {
    for (const junk of [null, "", "NA", "--", "98911 46116"]) {
      mockDealFetch({ pocEmail: junk, contact: { email: "owner@acme.example" } });

      const deal = await fetchDealWithLineItemsAndContact("deal-1");

      expect(deal.billingEmail).toBe("owner@acme.example");
    }
  });

  it("uses the Billing POC Email and name as the identity when the deal has no associated contact", async () => {
    mockDealFetch({ pocEmail: "accounts@acme.example", pocName: "Ayurpet", contact: null });

    const deal = await fetchDealWithLineItemsAndContact("deal-1");

    expect(deal.contactEmail).toBe("accounts@acme.example");
    expect(deal.billingEmail).toBe("accounts@acme.example");
    expect(deal.contactName).toBe("Ayurpet");
    expect(deal.contactPhone).toBeNull();
  });

  it("still refuses a deal with no contact email and no valid POC email", async () => {
    mockDealFetch({ pocEmail: "NA", contact: null });

    await expect(fetchDealWithLineItemsAndContact("deal-1")).rejects.toThrow(/no associated contact email and no valid Billing POC Email/);
  });
});

describe("updateDealBillingPocEmail", () => {
  it("PATCHes the deal's billing_poc_email, and clears it with an empty string", async () => {
    const calls = mockDealFetch({ contact: null });

    await updateDealBillingPocEmail("deal-1", "accounts@acme.example");
    await updateDealBillingPocEmail("deal-1", null);

    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches.map((c) => c.body)).toEqual([
      { properties: { billing_poc_email: "accounts@acme.example" } },
      { properties: { billing_poc_email: "" } },
    ]);
  });
});

describe("fetchVaDealEmails", () => {
  it("reads every deal's Billing POC Email and primary contact email in three batch calls; a deal missing from a batch result is left blank", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      calls.push(path);
      if (path.endsWith("/crm/v3/objects/deals/batch/read")) {
        const body = JSON.parse(String(init?.body)) as { inputs: Array<{ id: string }> };
        return jsonResponse({
          results: body.inputs.filter(({ id }) => id !== "d3").map(({ id }) => ({
            id,
            properties: { billing_poc_email: id === "d1" ? "accounts@one.example" : "NA" },
          })),
        });
      }
      if (path.endsWith("/crm/v4/associations/deals/contacts/batch/read")) {
        return jsonResponse({ results: [{ from: { id: "d1" }, to: [{ toObjectId: 501 }] }, { from: { id: "d2" }, to: [{ toObjectId: 502 }] }] }, 207);
      }
      if (path.endsWith("/crm/v3/objects/contacts/batch/read")) {
        return jsonResponse({
          results: [
            { id: "501", properties: { email: "owner@one.example" } },
            { id: "502", properties: { email: "owner@two.example" } },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    }) as unknown as typeof fetch;

    const emails = await fetchVaDealEmails(["d1", "d2", "d3"]);

    expect(calls).toHaveLength(3);
    expect(emails.get("d1")).toEqual({ billingPocEmail: "accounts@one.example", contactEmail: "owner@one.example" });
    expect(emails.get("d2")).toEqual({ billingPocEmail: "NA", contactEmail: "owner@two.example" });
    expect(emails.get("d3")).toEqual({ billingPocEmail: null, contactEmail: null });
  });
});
