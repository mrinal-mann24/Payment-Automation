import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDealWithLineItemsAndContact,
  fetchVaDealEmails,
  updateDealAccountantEmail,
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
function mockDealFetch(opts: {
  accountantEmail?: string | null;
  pocEmail?: string | null;
  pocName?: string | null;
  contact: { email?: string; phone?: string } | null;
}) {
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
          accountant_email: opts.accountantEmail ?? null,
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
  it("emails go to the deal's Accountant Email when it is a real address; the contact stays the Zoho identity", async () => {
    mockDealFetch({ accountantEmail: "accounts@acme.example", contact: { email: "owner@acme.example", phone: "9876543210" } });

    const deal = await fetchDealWithLineItemsAndContact("deal-1");

    expect(deal.billingEmail).toBe("accounts@acme.example");
    expect(deal.contactEmail).toBe("owner@acme.example");
    expect(deal.contactName).toBe("Client Name");
  });

  it("has no billing email at all when the Accountant Email is blank or junk — never the contact's, never the POC's", async () => {
    for (const junk of [null, "", "NA", "--", "98911 46116"]) {
      mockDealFetch({ accountantEmail: junk, pocEmail: "poc@acme.example", contact: { email: "owner@acme.example" } });

      const deal = await fetchDealWithLineItemsAndContact("deal-1");

      expect(deal.billingEmail).toBeNull();
      expect(deal.contactEmail).toBe("owner@acme.example");
    }
  });

  it("uses the Accountant Email as the Zoho identity when the deal has no associated contact", async () => {
    mockDealFetch({ accountantEmail: "accounts@acme.example", pocName: "Ayurpet", contact: null });

    const deal = await fetchDealWithLineItemsAndContact("deal-1");

    expect(deal.contactEmail).toBe("accounts@acme.example");
    expect(deal.billingEmail).toBe("accounts@acme.example");
    expect(deal.contactName).toBe("Ayurpet");
    expect(deal.contactPhone).toBeNull();
  });

  it("still refuses a deal with no contact email and no valid Accountant Email", async () => {
    mockDealFetch({ accountantEmail: "NA", pocEmail: "poc@acme.example", contact: null });

    await expect(fetchDealWithLineItemsAndContact("deal-1")).rejects.toThrow(/no associated contact email and no valid Accountant Email/);
  });
});

describe("updateDealAccountantEmail", () => {
  it("PATCHes the deal's accountant_email, and clears it with an empty string", async () => {
    const calls = mockDealFetch({ contact: null });

    await updateDealAccountantEmail("deal-1", "accounts@acme.example");
    await updateDealAccountantEmail("deal-1", null);

    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches.map((c) => c.body)).toEqual([
      { properties: { accountant_email: "accounts@acme.example" } },
      { properties: { accountant_email: "" } },
    ]);
  });
});

describe("fetchVaDealEmails", () => {
  it("reads every deal's Accountant Email in one batch call; a deal missing from the result is left blank", async () => {
    const calls: string[] = [];
    let requestedProperties: string[] = [];
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      calls.push(path);
      if (path.endsWith("/crm/v3/objects/deals/batch/read")) {
        const body = JSON.parse(String(init?.body)) as { inputs: Array<{ id: string }>; properties: string[] };
        requestedProperties = body.properties;
        return jsonResponse({
          results: body.inputs.filter(({ id }) => id !== "d3").map(({ id }) => ({
            id,
            properties: { accountant_email: id === "d1" ? "accounts@one.example" : "NA" },
          })),
        });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    }) as unknown as typeof fetch;

    const emails = await fetchVaDealEmails(["d1", "d2", "d3"]);

    expect(calls).toHaveLength(1);
    expect(requestedProperties).toEqual(["accountant_email"]);
    expect(emails.get("d1")).toEqual({ accountantEmail: "accounts@one.example" });
    expect(emails.get("d2")).toEqual({ accountantEmail: "NA" });
    expect(emails.get("d3")).toEqual({ accountantEmail: null });
  });

  it("makes no call for an empty deal list", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;

    expect((await fetchVaDealEmails([])).size).toBe(0);
  });
});
