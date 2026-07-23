import { config } from "../config.js";
import type { HubspotDeal } from "./hubspot.js";

const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.in/oauth/v2/token";
const ZOHO_BOOKS_URL = "https://www.zohoapis.in/books/v3";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const params = new URLSearchParams({
    refresh_token: config.zoho.refreshToken,
    client_id: config.zoho.clientId,
    client_secret: config.zoho.clientSecret,
    grant_type: "refresh_token",
  });

  const response = await fetch(`${ZOHO_ACCOUNTS_URL}?${params.toString()}`, {
    method: "POST",
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

interface ZohoEstimateCreateResponse {
  estimate: {
    estimate_id: string;
    estimate_number: string;
    total: number;
  };
}

export async function createEstimate(
  customerId: string,
  deal: HubspotDeal,
): Promise<{ estimateId: string; estimateNumber: string; total: number }> {
  const params = new URLSearchParams({ organization_id: config.zoho.orgId });

  const firstLineItem = deal.lineItems[0];
  if (!firstLineItem) {
    throw new Error(`HubSpot deal ${deal.dealId} has no line items`);
  }

  const result = (await zohoFetch(`/estimates?${params.toString()}`, {
    method: "POST",
    body: JSON.stringify({
      customer_id: customerId,
      reference_number: deal.dealId,
      line_items: [
        {
          name: firstLineItem.name,
          rate: firstLineItem.price,
          quantity: firstLineItem.quantity,
        },
      ],
    }),
  })) as ZohoEstimateCreateResponse;

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
  invoice: { invoice_id: string; invoice_number: string };
}

async function getEstimate(estimateId: string): Promise<ZohoEstimateGetResponse["estimate"]> {
  const result = (await zohoFetch(
    `/estimates/${estimateId}?organization_id=${config.zoho.orgId}`,
  )) as ZohoEstimateGetResponse;
  return result.estimate;
}

async function getInvoiceNumber(invoiceId: string): Promise<string> {
  const result = (await zohoFetch(
    `/invoices/${invoiceId}?organization_id=${config.zoho.orgId}`,
  )) as ZohoInvoiceGetResponse;
  return result.invoice.invoice_number;
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
