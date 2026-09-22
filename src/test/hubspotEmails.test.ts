import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDealWithLineItemsAndContact,
  fetchVaDealEmails,
  updateDealAccountantEmails,
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
  accountantEmails?: Array<string | null>;
  pocEmail?: string | null;
  pocName?: string | null;
  contact: { email?: string; phone?: string } | null;
  missingFields?: string[]; // Accountant Email properties not yet created in HubSpot
}) {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const [e1 = null, e2 = null, e3 = null] = opts.accountantEmails ?? [];
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
          accountant_email: e1,
          accountant_email_2: e2,
          accountant_email_3: e3,
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
    const property = /\/crm\/v3\/properties\/deals\/([a-z_0-9]+)$/.exec(path);
    if (property) {
      return (opts.missingFields ?? []).includes(property[1]!)
        ? new Response("{}", { status: 404 })
        : jsonResponse({ name: property[1] });
    }
    throw new Error(`Unexpected fetch: ${path}`);
  }) as unknown as typeof fetch;
  return calls;
}

describe("fetchDealWithLineItemsAndContact — billing emails", () => {
  it("collects every Accountant Email field that holds a real address; the contact stays the Zoho identity", async () => {
    mockDealFetch({
      accountantEmails: ["accounts@acme.example", "cfo@acme.example", "NA"],
      contact: { email: "owner@acme.example", phone: "9876543210" },
    });

    const deal = await fetchDealWithLineItemsAndContact("deal-1");

    expect(deal.billingEmails).toEqual(["accounts@acme.example", "cfo@acme.example"]);
    expect(deal.contactEmail).toBe("owner@acme.example");
    expect(deal.contactName).toBe("Client Name");
  });

  it("drops duplicates and junk, and has no billing email at all when none of the three is an address", async () => {
    mockDealFetch({ accountantEmails: ["accounts@acme.example", " accounts@acme.example ", null], contact: { email: "owner@acme.example" } });
    expect((await fetchDealWithLineItemsAndContact("deal-1")).billingEmails).toEqual(["accounts@acme.example"]);

    for (const junk of [[], [null, null, null], ["", "NA", "--"], ["98911 46116"]]) {
      mockDealFetch({ accountantEmails: junk, pocEmail: "poc@acme.example", contact: { email: "owner@acme.example" } });
      expect((await fetchDealWithLineItemsAndContact("deal-1")).billingEmails).toEqual([]);
    }
  });

  it("uses the first Accountant Email as the Zoho identity when the deal has no associated contact", async () => {
    mockDealFetch({ accountantEmails: [null, "cfo@acme.example"], pocName: "Ayurpet", contact: null });

    const deal = await fetchDealWithLineItemsAndContact("deal-1");

    expect(deal.contactEmail).toBe("cfo@acme.example");
    expect(deal.billingEmails).toEqual(["cfo@acme.example"]);
    expect(deal.contactName).toBe("Ayurpet");
    expect(deal.contactPhone).toBeNull();
  });

  it("still refuses a deal with no contact email and no valid Accountant Email", async () => {
    mockDealFetch({ accountantEmails: ["NA"], pocEmail: "poc@acme.example", contact: null });

    await expect(fetchDealWithLineItemsAndContact("deal-1")).rejects.toThrow(/no associated contact email and no valid Accountant Email/);
  });
});

describe("updateDealAccountantEmails", () => {
  it("writes only the fields that exist in HubSpot while 2 and 3 have not been created yet", async () => {
    const calls = mockDealFetch({ contact: null, missingFields: ["accountant_email_2", "accountant_email_3"] });

    await updateDealAccountantEmails("deal-1", ["accounts@acme.example", null, null]);

    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([
      { properties: { accountant_email: "accounts@acme.example" } },
    ]);
  });

  it("refuses an address for a field that does not exist yet, naming the field", async () => {
    const calls = mockDealFetch({ contact: null, missingFields: ["accountant_email_2", "accountant_email_3"] });

    await expect(updateDealAccountantEmails("deal-1", ["accounts@acme.example", "cfo@acme.example", null])).rejects.toThrow(
      /Accountant Email 2 .*does not exist in HubSpot/,
    );
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("PATCHes all three Accountant Email fields, clearing the blank ones with an empty string", async () => {
    const calls = mockDealFetch({ contact: null });

    await updateDealAccountantEmails("deal-1", ["accounts@acme.example", null, "cfo@acme.example"]);
    await updateDealAccountantEmails("deal-1", [null, null, null]);

    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches.map((c) => c.body)).toEqual([
      { properties: { accountant_email: "accounts@acme.example", accountant_email_2: "", accountant_email_3: "cfo@acme.example" } },
      { properties: { accountant_email: "", accountant_email_2: "", accountant_email_3: "" } },
    ]);
  });
});

describe("fetchVaDealEmails", () => {
  it("reads every deal's three Accountant Email fields in one batch call; a deal missing from the result is left blank", async () => {
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
            properties:
              id === "d1"
                ? { accountant_email: "accounts@one.example", accountant_email_2: "cfo@one.example", accountant_email_3: null }
                : { accountant_email: "NA", accountant_email_2: "", accountant_email_3: null },
          })),
        });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    }) as unknown as typeof fetch;

    const emails = await fetchVaDealEmails(["d1", "d2", "d3"]);

    expect(calls).toHaveLength(1);
    expect(requestedProperties).toEqual(["accountant_email", "accountant_email_2", "accountant_email_3"]);
    expect(emails.get("d1")).toEqual({ accountantEmails: ["accounts@one.example", "cfo@one.example", null] });
    expect(emails.get("d2")).toEqual({ accountantEmails: ["NA", null, null] });
    expect(emails.get("d3")).toEqual({ accountantEmails: [null, null, null] });
  });

  it("makes no call for an empty deal list", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;

    expect((await fetchVaDealEmails([])).size).toBe(0);
  });
});
