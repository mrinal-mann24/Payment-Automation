import { config } from "../config.js";
import type { HubspotDeal } from "./hubspot.js";

const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.in/oauth/v2/token";
const ZOHO_BOOKS_URL = "https://www.zohoapis.in/books/v3";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;
let refreshInFlight: Promise<string> | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  // De-dupe concurrent cache misses (e.g. several pipeline steps racing
  // right after the cached token expires) into a single refresh call
  // instead of each firing its own request at Zoho's OAuth endpoint.
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const params = new URLSearchParams({
        refresh_token: config.zoho.refreshToken,
        client_id: config.zoho.clientId,
        client_secret: config.zoho.clientSecret,
        grant_type: "refresh_token",
      });

      // Sent as a POST body, not query-string params — query strings are
      // more likely to end up in proxy/access logs than a request body.
      const response = await fetch(ZOHO_ACCOUNTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Zoho OAuth token refresh failed ${response.status}: ${body}`);
      }

      const data = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
      };

      if (!data.access_token) {
        throw new Error(`Zoho OAuth token refresh failed: ${data.error ?? "no access_token in response"}`);
      }

      cachedToken = {
        accessToken: data.access_token,
        expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
      };

      return cachedToken.accessToken;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function zohoFetch(path: string, init?: RequestInit): Promise<unknown> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${ZOHO_BOOKS_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Zoho Books API error ${response.status}: ${body}`);
  }

  return response.json();
}

async function zohoFetchPdf(path: string): Promise<Buffer> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${ZOHO_BOOKS_URL}${path}`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: "application/pdf",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Zoho Books API error ${response.status}: ${body}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

interface ZohoCustomer {
  contact_id: string;
  contact_name: string;
  email: string;
}

interface ZohoContactsSearchResponse {
  contacts: ZohoCustomer[];
}

interface ZohoContactCreateResponse {
  contact: ZohoCustomer;
}

export async function findOrCreateCustomer(
  email: string,
  contactName: string,
): Promise<string> {
  const searchParams = new URLSearchParams({
    organization_id: config.zoho.orgId,
    email,
  });

  const searchResult = (await zohoFetch(
    `/contacts?${searchParams.toString()}`,
  )) as ZohoContactsSearchResponse;

  const existing = searchResult.contacts.find(
    (c) => c.email.toLowerCase() === email.toLowerCase(),
  );
  if (existing) {
    return existing.contact_id;
  }

  const createParams = new URLSearchParams({ organization_id: config.zoho.orgId });
  const created = (await zohoFetch(`/contacts?${createParams.toString()}`, {
    method: "POST",
    body: JSON.stringify({
      contact_name: contactName || email,
      contact_persons: [{ email, is_primary_contact: true }],
    }),
  })) as ZohoContactCreateResponse;

  return created.contact.contact_id;
}

// GST18 (18%) and the "Professional fees New tax" TDS rate (10%), confirmed
// against this org's real Settings > Taxes / GST TDS records (tax_id values
// are org-specific and only discoverable via GET /settings/taxes or an
// existing estimate that already applies them — not derivable from the tax
// name/percentage alone).
const GST18_TAX_ID = "2273874000000030203";
const PROFESSIONAL_FEES_TDS_TAX_ID = "2273874000000527020";

interface ZohoEstimateCreateResponse {
  estimate: {
    estimate_id: string;
    estimate_number: string;
    total: number;
  };
}

export interface EstimateLine {
  key: string; // suffix of the Zoho reference number: "<dealId>/<key>"
  name?: string; // line item name; "Virtual Accounting" for a billing cycle
  description?: string | null; // printed beneath the name (service period / narration)
}

// `line` marks a billing cycle or a one-time quote: one line item, named
// (bold in Zoho's PDF) with the description beneath it, and a reference
// number that makes each quote distinguishable in Zoho. Without it the
// legacy payload is unchanged.
export async function createEstimate(
  customerId: string,
  deal: HubspotDeal,
  line?: EstimateLine,
): Promise<{ estimateId: string; estimateNumber: string; total: number }> {
  const params = new URLSearchParams({ organization_id: config.zoho.orgId });

  const firstLineItem = deal.lineItems[0];
  if (!firstLineItem) {
    throw new Error(`HubSpot deal ${deal.dealId} has no line items`);
  }

  const lineItem = line
    ? {
        name: line.name ?? "Virtual Accounting",
        ...(line.description ? { description: line.description } : {}),
        rate: firstLineItem.price,
        quantity: 1,
      }
    : { name: firstLineItem.name, rate: firstLineItem.price, quantity: firstLineItem.quantity };

  const result = (await zohoFetch(`/estimates?${params.toString()}`, {
    method: "POST",
    body: JSON.stringify({
      customer_id: customerId,
      reference_number: line ? `${deal.dealId}/${line.key}` : deal.dealId,
      line_items: [
        {
          ...lineItem,
          tax_id: GST18_TAX_ID,
          tds_tax_id: PROFESSIONAL_FEES_TDS_TAX_ID,
        },
      ],
    }),
  })) as ZohoEstimateCreateResponse;

  // Zoho can return HTTP 200 with a body that doesn't match the expected
  // shape (e.g. a validation message under a different key) — fail loudly
  // here rather than letting `undefined` fields silently reach the
  // Razorpay amount calculation or renewal_jobs write.
  if (
    !result.estimate?.estimate_id ||
    !result.estimate?.estimate_number ||
    typeof result.estimate?.total !== "number"
  ) {
    throw new Error(
      `Zoho /estimates response for deal ${deal.dealId} is missing expected fields: ${JSON.stringify(result)}`,
    );
  }

  return {
    estimateId: result.estimate.estimate_id,
    estimateNumber: result.estimate.estimate_number,
    total: result.estimate.total,
  };
}

export async function getEstimatePdf(estimateId: string): Promise<Buffer> {
  const params = new URLSearchParams({
    organization_id: config.zoho.orgId,
    estimate_ids: estimateId,
  });

  return zohoFetchPdf(`/estimates/pdf?${params.toString()}`);
}

export async function getInvoicePdf(invoiceId: string): Promise<Buffer> {
  const params = new URLSearchParams({
    organization_id: config.zoho.orgId,
    invoice_ids: invoiceId,
  });

  return zohoFetchPdf(`/invoices/pdf?${params.toString()}`);
}

interface ZohoInvoiceFromEstimatesResponse {
  code: number;
  message: string;
  data?: {
    code: number;
    ids?: string[];
    message: string;
  };
}

interface ZohoEstimateGetResponse {
  estimate: {
    status: string;
    invoice_ids?: string[];
  };
}

interface ZohoInvoiceGetResponse {
  invoice: {
    invoice_id: string;
    invoice_number: string;
    customer_id: string;
    status: string;
    total: number;
    balance: number;
  };
}

export interface ZohoInvoice {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  status: string; // draft | sent | paid | partially_paid | overdue | void …
  total: number;
  balance: number;
}

export async function getInvoice(invoiceId: string): Promise<ZohoInvoice> {
  const result = (await zohoFetch(
    `/invoices/${invoiceId}?organization_id=${config.zoho.orgId}`,
  )) as ZohoInvoiceGetResponse;
  const invoice = result.invoice;
  return {
    invoiceId: invoice.invoice_id,
    invoiceNumber: invoice.invoice_number,
    customerId: invoice.customer_id,
    status: invoice.status,
    total: invoice.total,
    balance: invoice.balance,
  };
}

async function getEstimate(estimateId: string): Promise<ZohoEstimateGetResponse["estimate"]> {
  const result = (await zohoFetch(
    `/estimates/${estimateId}?organization_id=${config.zoho.orgId}`,
  )) as ZohoEstimateGetResponse;
  return result.estimate;
}

async function getInvoiceNumber(invoiceId: string): Promise<string> {
  return (await getInvoice(invoiceId)).invoiceNumber;
}

export async function convertEstimateToInvoice(
  estimateId: string,
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  // Zoho estimate->invoice conversion is not idempotent on Zoho's side —
  // calling /invoices/fromestimates again on an already-invoiced estimate
  // can create a duplicate invoice rather than erroring. Check first and
  // reuse the existing linked invoice if this estimate was already
  // converted (e.g. a retry after our own DB write failed downstream).
  const existing = await getEstimate(estimateId);
  const existingInvoiceId = existing.invoice_ids?.[0];
  if (existing.status === "invoiced" && existingInvoiceId) {
    return {
      invoiceId: existingInvoiceId,
      invoiceNumber: await getInvoiceNumber(existingInvoiceId),
    };
  }

  // Zoho Books rejects conversion of a DRAFT estimate via this endpoint
  // even though the web UI allows it directly from DRAFT — confirmed by
  // testing both against the same estimate. Mark it Sent first.
  await zohoFetch(`/estimates/${estimateId}/status/sent?organization_id=${config.zoho.orgId}`, {
    method: "POST",
  });

  const params = new URLSearchParams({
    organization_id: config.zoho.orgId,
    estimate_ids: estimateId,
  });
  const result = (await zohoFetch(`/invoices/fromestimates?${params.toString()}`, {
    method: "POST",
  })) as ZohoInvoiceFromEstimatesResponse;

  if (result.data?.code) {
    throw new Error(
      `Zoho invoices/fromestimates could not convert estimate ${estimateId}: ${result.data.message}`,
    );
  }

  // The fromestimates response body carries no invoice id/number on
  // success (confirmed live: {"code":0,"data":{}}) — read it back off the
  // estimate's own invoice_ids instead of trying to parse it out of here.
  const converted = await getEstimate(estimateId);
  const invoiceId = converted.invoice_ids?.[0];
  if (!invoiceId) {
    throw new Error(`Estimate ${estimateId} has no linked invoice after conversion`);
  }

  // Invoices created via fromestimates land in DRAFT status. Mark it Sent
  // so it doesn't sit as a draft in Zoho once the client has it.
  await markInvoiceAsSent(invoiceId);

  return {
    invoiceId,
    invoiceNumber: await getInvoiceNumber(invoiceId),
  };
}

export async function markInvoiceAsSent(invoiceId: string): Promise<void> {
  await zohoFetch(`/invoices/${invoiceId}/status/sent?organization_id=${config.zoho.orgId}`, {
    method: "POST",
  });
}

export interface ZohoEmail {
  to: string[];
  subject: string;
  body: string;
}

// Zoho emails the document itself, from the organisation's email address
// (send_from_org_email_id — the business wants accounts@aiaccountant.com,
// which must be set and verified as the org email in Zoho Books; decision
// 2026-09-23). `body` is the message text — the Razorpay link has to be
// put there by the caller, Zoho's own templates know nothing about it.
// Covered by the estimates.CREATE / invoices.CREATE scopes.
export async function emailEstimate(estimateId: string, email: ZohoEmail): Promise<void> {
  await zohoFetch(`/estimates/${estimateId}/email?organization_id=${config.zoho.orgId}`, {
    method: "POST",
    body: JSON.stringify({ to_mail_ids: email.to, subject: email.subject, body: email.body, send_from_org_email_id: true }),
  });
}

export async function emailInvoice(invoiceId: string, email: ZohoEmail): Promise<void> {
  await zohoFetch(`/invoices/${invoiceId}/email?organization_id=${config.zoho.orgId}`, {
    method: "POST",
    body: JSON.stringify({ to_mail_ids: email.to, subject: email.subject, body: email.body, send_from_org_email_id: true }),
  });
}

export interface ZohoPaymentInput {
  mode: string; // Zoho payment_mode: banktransfer | check | cash | others …
  date: string; // YYYY-MM-DD
  reference: string | null;
  description: string;
}

// Records a customer payment for the invoice's full balance so Zoho Books
// shows it as Paid (and its own reminders stop). Needs the
// ZohoBooks.customerpayments.CREATE scope — missing from the token as of
// 2026-09-22 (401, code 57), so the step fails and is retried daily until
// the token is re-granted. An invoice Zoho already shows as paid is left
// alone.
export async function recordInvoicePayment(
  invoiceId: string,
  payment: ZohoPaymentInput,
): Promise<{ paymentId: string; alreadyPaid: boolean }> {
  const invoice = await getInvoice(invoiceId);
  if (invoice.status === "paid" || invoice.balance <= 0) {
    return { paymentId: "paid-in-zoho", alreadyPaid: true };
  }

  const result = (await zohoFetch(`/customerpayments?organization_id=${config.zoho.orgId}`, {
    method: "POST",
    body: JSON.stringify({
      customer_id: invoice.customerId,
      payment_mode: payment.mode,
      amount: invoice.balance,
      date: payment.date,
      reference_number: payment.reference ?? "",
      description: payment.description,
      invoices: [{ invoice_id: invoiceId, amount_applied: invoice.balance }],
    }),
  })) as { payment: { payment_id: string } };

  return { paymentId: result.payment.payment_id, alreadyPaid: false };
}
