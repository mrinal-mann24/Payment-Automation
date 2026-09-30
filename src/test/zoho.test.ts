import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEstimate, emailEstimate, emailInvoice, getCustomer, recordInvoicePayment, searchCustomers } from "../clients/zoho.js";

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
      description: "Service period: 1 October 2026 to 31 October 2026",
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

describe("searchCustomers / getCustomer", () => {
  function mockContactsFetch(): { urls: string[] } {
    const captured = { urls: [] as string[] };
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.startsWith("https://accounts.zoho.in/")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      captured.urls.push(path);
      if (path.includes("/contacts/2273874000000777001?")) {
        return new Response(
          JSON.stringify({ contact: { contact_id: "2273874000000777001", contact_name: "Test RenewalAutomation", status: "active" } }),
          { status: 200 },
        );
      }
      if (path.includes("/contacts?")) {
        return new Response(
          JSON.stringify({
            contacts: [
              { contact_id: "2273874000000777001", contact_name: "Test RenewalAutomation", company_name: "", email: "", status: "active" },
              { contact_id: "2273874000000918216", contact_name: "Forelife Health Systems Private Limited", company_name: "Forelife Health Systems Private Limited", status: "active" },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${path}`);
    }) as unknown as typeof fetch;
    return captured;
  }

  it("searches Zoho's customers by name and returns id, name, company and email (blank as null)", async () => {
    const captured = mockContactsFetch();

    const customers = await searchCustomers("Test Renewal");

    expect(captured.urls[0]).toContain("/contacts?");
    expect(captured.urls[0]).toContain("contact_type=customer");
    expect(captured.urls[0]).toContain("contact_name_contains=Test+Renewal");
    expect(customers).toEqual([
      { contactId: "2273874000000777001", contactName: "Test RenewalAutomation", companyName: null, email: null, status: "active" },
      {
        contactId: "2273874000000918216",
        contactName: "Forelife Health Systems Private Limited",
        companyName: "Forelife Health Systems Private Limited",
        email: null,
        status: "active",
      },
    ]);
  });

  it("reads one customer back by id", async () => {
    mockContactsFetch();

    expect(await getCustomer("2273874000000777001")).toEqual({ contactId: "2273874000000777001", contactName: "Test RenewalAutomation" });
  });
});

describe("emailEstimate / emailInvoice", () => {
  function mockEmailFetch(): { calls: Array<{ path: string; body: Record<string, unknown> }> } {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.startsWith("https://accounts.zoho.in/")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      calls.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ code: 0, message: "Your estimate has been sent." }), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls };
  }

  it("posts to Zoho's email endpoints with the recipient, subject and body", async () => {
    const { calls } = mockEmailFetch();

    await emailEstimate("zest-1", { to: ["client@example.com", "cfo@example.com"], subject: "Quote QT-1", body: "Hello" });
    await emailInvoice("zinv-1", { to: ["client@example.com"], subject: "Invoice INV-1", body: "Thanks" });

    expect(calls[0]!.path).toBe("https://www.zohoapis.in/books/v3/estimates/zest-1/email?organization_id=org-1");
    expect(calls[0]!.body).toEqual({
      to_mail_ids: ["client@example.com", "cfo@example.com"],
      subject: "Quote QT-1",
      body: "Hello",
      send_from_org_email_id: true,
    });
    expect(calls[1]!.path).toBe("https://www.zohoapis.in/books/v3/invoices/zinv-1/email?organization_id=org-1");
    expect(calls[1]!.body).toEqual({
      to_mail_ids: ["client@example.com"],
      subject: "Invoice INV-1",
      body: "Thanks",
      send_from_org_email_id: true,
    });
  });
});

describe("createEstimate for a one-time quote", () => {
  it("bills it under its own service name and narration, with a per-quote reference", async () => {
    const captured = mockZohoFetch();

    await createEstimate("zcust-1", { ...deal, lineItems: [{ id: "", name: "ignored", quantity: 1, price: 2500 }] }, {
      key: "addition-row-1",
      name: "Site visit",
      description: "Visit to the Pune office on 12 October",
    });

    expect(captured.body).toMatchObject({
      reference_number: "deal-1/addition-row-1",
      line_items: [{ name: "Site visit", description: "Visit to the Pune office on 12 October", rate: 2500, quantity: 1 }],
    });
  });

  it("leaves the description out when there is no narration", async () => {
    const captured = mockZohoFetch();

    await createEstimate("zcust-1", deal, { key: "addition-row-2", name: "Site visit", description: null });

    const lineItem = (captured.body!.line_items as Array<Record<string, unknown>>)[0]!;
    expect(lineItem).toMatchObject({ name: "Site visit", quantity: 1 });
    expect(lineItem).not.toHaveProperty("description");
  });
});

describe("recordInvoicePayment", () => {
  function mockInvoiceFetch(invoice: { status: string; balance: number }) {
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> | undefined }> = [];
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.startsWith("https://accounts.zoho.in/")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      calls.push({
        path,
        method: init?.method ?? "GET",
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      });
      if (path.includes("/invoices/zinv-1?")) {
        return new Response(
          JSON.stringify({
            invoice: { invoice_id: "zinv-1", invoice_number: "INV-1", customer_id: "cust-1", total: 3240, ...invoice },
          }),
          { status: 200 },
        );
      }
      if (path.includes("/customerpayments?")) {
        return new Response(JSON.stringify({ code: 0, payment: { payment_id: "zpay-1", amount: 3240 } }), { status: 201 });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    }) as unknown as typeof fetch;
    return calls;
  }

  const payment = {
    mode: "banktransfer",
    date: "2026-09-22",
    reference: "UTR 123",
    description: "Paid via Yes Bank",
    amount: null as number | null,
  };

  it("records a customer payment for the invoice's full balance so Zoho shows it as paid", async () => {
    const calls = mockInvoiceFetch({ status: "sent", balance: 3240 });

    expect(await recordInvoicePayment("zinv-1", payment)).toEqual({ paymentId: "zpay-1", alreadyPaid: false });

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toContain("/customerpayments?organization_id=org-1");
    expect(post.body).toEqual({
      customer_id: "cust-1",
      payment_mode: "banktransfer",
      amount: 3240,
      date: "2026-09-22",
      reference_number: "UTR 123",
      description: "Paid via Yes Bank",
      invoices: [{ invoice_id: "zinv-1", amount_applied: 3240 }],
    });
  });

  it("records the amount actually received when it is less than the balance, and never more than the balance", async () => {
    const short = mockInvoiceFetch({ status: "sent", balance: 3240 });
    await recordInvoicePayment("zinv-1", { ...payment, amount: 3000 });
    expect(short.find((c) => c.method === "POST")!.body).toMatchObject({
      amount: 3000,
      invoices: [{ invoice_id: "zinv-1", amount_applied: 3000 }],
    });

    const over = mockInvoiceFetch({ status: "sent", balance: 3240 });
    await recordInvoicePayment("zinv-1", { ...payment, amount: 5000 });
    expect(over.find((c) => c.method === "POST")!.body).toMatchObject({
      amount: 3240,
      invoices: [{ invoice_id: "zinv-1", amount_applied: 3240 }],
    });
  });

  it("does not record a second payment when Zoho already shows the invoice as paid", async () => {
    const calls = mockInvoiceFetch({ status: "paid", balance: 0 });

    expect(await recordInvoicePayment("zinv-1", payment)).toEqual({ paymentId: "paid-in-zoho", alreadyPaid: true });

    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});
