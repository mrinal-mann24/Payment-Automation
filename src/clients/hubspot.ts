import { config } from "../config.js";
import { toIsoDate } from "../utils/billingCycle.js";

const HUBSPOT_BASE_URL = "https://api.hubapi.com";

export interface HubspotLineItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  // Recurring-billing properties (HubSpot names: recurringbillingfrequency,
  // hs_recurring_billing_period, hs_recurring_billing_start_date,
  // billing_term_end_date, recurring_revenue_type, hs_product_id). Dates are
  // normalised to YYYY-MM-DD. Optional so existing fixtures stay valid.
  recurringBillingFrequency?: string | null;
  billingPeriodTerm?: string | null;
  billingStartDate?: string | null;
  billingTermEndDate?: string | null;
  recurringRevenueType?: string | null;
  productId?: string | null;
}

const LINE_ITEM_PROPERTIES = [
  "name",
  "quantity",
  "price",
  "recurringbillingfrequency",
  "hs_recurring_billing_period",
  "hs_recurring_billing_start_date",
  "billing_term_end_date",
  "recurring_revenue_type",
  "hs_product_id",
];

export interface HubspotDeal {
  dealId: string;
  dealName: string;
  billingPeriod: string | null;
  contactEmail: string; // Zoho customer identity: the associated contact, or the Accountant Email when there is no contact
  contactName: string;
  contactPhone: string | null;
  // Where quotes and invoices are emailed: every Accountant Email field
  // (1–3) that holds a real address. Empty means NO email is sent — there
  // is deliberately no fallback to the contact. Optional only so test
  // fixtures stay valid; the fetch always sets it.
  billingEmails?: string[];
  lineItems: HubspotLineItem[];
}

async function hubspotFetch(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${HUBSPOT_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.hubspot.privateAppToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HubSpot API error ${response.status}: ${body}`);
  }

  return response.json();
}

interface HubspotDealResponse {
  id: string;
  properties: {
    dealname?: string;
    billing_cycle?: string;
    next_renewal_date?: string;
    accountant_email?: string | null;
    accountant_email_2?: string | null;
    accountant_email_3?: string | null;
    billing_poc_name?: string | null;
  };
  associations?: {
    "line items"?: { results: Array<{ id: string }> };
    contacts?: { results: Array<{ id: string }> };
  };
}

interface HubspotLineItemResponse {
  id: string;
  properties: {
    name?: string;
    quantity?: string;
    price?: string;
    recurringbillingfrequency?: string | null;
    hs_recurring_billing_period?: string | null;
    hs_recurring_billing_start_date?: string | null;
    billing_term_end_date?: string | null;
    recurring_revenue_type?: string | null;
    hs_product_id?: string | null;
  };
}

interface HubspotContactResponse {
  id: string;
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
  };
}

// Free-text email fields hold junk on some live deals ("NA", "--", a
// phone number); anything that is not shaped like an address is ignored.
export function asEmail(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

// The deal fields documents are emailed to. HubSpot validates each as a
// single address, so several recipients need several fields; 2 and 3 are
// created by the team in HubSpot (the app token lacks the schema scope).
export const ACCOUNTANT_EMAIL_PROPERTIES = ["accountant_email", "accountant_email_2", "accountant_email_3"] as const;
type AccountantEmailProperty = (typeof ACCOUNTANT_EMAIL_PROPERTIES)[number];

// The valid, de-duplicated addresses across the Accountant Email fields.
function accountantEmails(properties: Partial<Record<AccountantEmailProperty, string | null>>): string[] {
  const emails: string[] = [];
  for (const name of ACCOUNTANT_EMAIL_PROPERTIES) {
    const email = asEmail(properties[name]);
    if (email && !emails.includes(email)) {
      emails.push(email);
    }
  }
  return emails;
}

export async function fetchDealWithLineItemsAndContact(dealId: string): Promise<HubspotDeal> {
  const deal = (await hubspotFetch(
    `/crm/v3/objects/deals/${dealId}?properties=dealname,billing_cycle,next_renewal_date,${ACCOUNTANT_EMAIL_PROPERTIES.join(",")},billing_poc_name&associations=line_items,contacts`,
  )) as HubspotDealResponse;

  const lineItemIds = deal.associations?.["line items"]?.results.map((r) => r.id) ?? [];
  const contactId = deal.associations?.contacts?.results[0]?.id;

  const [lineItems, contact] = await Promise.all([
    Promise.all(
      lineItemIds.map((id) =>
        hubspotFetch(
          `/crm/v3/objects/line_items/${id}?properties=${LINE_ITEM_PROPERTIES.join(",")}`,
        ) as Promise<HubspotLineItemResponse>,
      ),
    ),
    contactId
      ? (hubspotFetch(
          `/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,phone`,
        ) as Promise<HubspotContactResponse>)
      : Promise.resolve(null),
  ]);

  // The associated contact is the Zoho customer identity; the Accountant
  // Email fields are the only addresses documents are emailed to. A deal
  // with no contact can still be billed when an Accountant Email is set.
  const contactEmail = asEmail(contact?.properties.email);
  const billingEmails = accountantEmails(deal.properties);
  const identityEmail = contactEmail ?? billingEmails[0] ?? null;
  if (!identityEmail) {
    throw new Error(`HubSpot deal ${dealId} has no associated contact email and no valid Accountant Email`);
  }
  const contactName = contact
    ? [contact.properties.firstname, contact.properties.lastname].filter(Boolean).join(" ")
    : (deal.properties.billing_poc_name ?? "").trim();

  // Legacy (due-date-driven) cycle key. Billing cycles are keyed by their
  // own period instead, so missing properties are only an error on the
  // legacy path — createZohoEstimate decides, not this fetch.
  const billingCycle = deal.properties.billing_cycle;
  const nextRenewalDate = deal.properties.next_renewal_date;
  const billingPeriod = billingCycle && nextRenewalDate ? `${billingCycle}-${nextRenewalDate}` : null;

  return {
    dealId: deal.id,
    dealName: deal.properties.dealname ?? "",
    billingPeriod,
    contactEmail: identityEmail,
    contactName,
    contactPhone: contact?.properties.phone ?? null,
    billingEmails,
    lineItems: lineItems.map((item) => parseLineItem(dealId, item)),
  };
}

function parseLineItem(dealId: string, item: HubspotLineItemResponse): HubspotLineItem {
  const rawQuantity = item.properties.quantity;
  const rawPrice = item.properties.price;
  const quantity = rawQuantity === undefined ? 1 : Number(rawQuantity);
  const price = rawPrice === undefined ? 0 : Number(rawPrice);

  // HubSpot returns quantity/price as strings; a blank/malformed value
  // (e.g. "") coerces to 0 via bare Number(), which would silently create
  // a real ₹0 Zoho estimate instead of failing loudly. Reject anything
  // that isn't a finite, non-negative number instead.
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(
      `HubSpot line item ${item.id} on deal ${dealId} has an invalid quantity: ${JSON.stringify(rawQuantity)}`,
    );
  }
  if (!Number.isFinite(price) || price < 0) {
    throw new Error(
      `HubSpot line item ${item.id} on deal ${dealId} has an invalid price: ${JSON.stringify(rawPrice)}`,
    );
  }

  return {
    id: item.id,
    name: item.properties.name ?? "",
    quantity,
    price,
    recurringBillingFrequency: item.properties.recurringbillingfrequency ?? null,
    billingPeriodTerm: item.properties.hs_recurring_billing_period ?? null,
    billingStartDate: toIsoDate(item.properties.hs_recurring_billing_start_date),
    billingTermEndDate: toIsoDate(item.properties.billing_term_end_date),
    recurringRevenueType: item.properties.recurring_revenue_type ?? null,
    productId: item.properties.hs_product_id ?? null,
  };
}

// "Renewal Done" stage in the real Virtual Accounting pipeline (1534965463) —
// confirmed against a live deal (Leon Enterprises_VA), not a placeholder.
const VA_RENEWAL_DONE_DEALSTAGE = "3102360263";

export async function markDealRenewalDone(dealId: string): Promise<void> {
  await hubspotFetch(`/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: { dealstage: VA_RENEWAL_DONE_DEALSTAGE },
    }),
  });
}

// The three VA-pipeline stages that represent an active customer eligible
// for the renewal cron — confirmed directly by the business, not inferred
// from label text (dealstage IDs are portal-wide and the same label can
// belong to a different pipeline with a different ID).
export const VA_ACTIVE_CUSTOMER_DEALSTAGES = [
  "3668025064", // Ready for Renewal
  "3102360263", // Renewal Done
  "2462646003", // Payment Done
];

export async function fetchDealStage(dealId: string): Promise<string> {
  const deal = (await hubspotFetch(
    `/crm/v3/objects/deals/${dealId}?properties=dealstage`,
  )) as { properties: { dealstage?: string } };

  return deal.properties.dealstage ?? "";
}

// The real Virtual Accounting pipeline ID — same constant as
// src/clients/neon.ts::VA_PIPELINE_ID, duplicated here since that one is
// scoped to filtering Neon's line_items table, not HubSpot deal search.
const VA_PIPELINE_ID = "1534965463";

export interface VaPipelineDeal {
  dealId: string;
  dealName: string;
  dealStage: string;
  billingCycle: string | null;
  nextRenewalDate: string | null; // HubSpot next_renewal_date (YYYY-MM-DD): the day the client is next quoted
}

// Used by the pricing admin interface to list deals to price/charge —
// same pipeline + active-customer-stage filter as
// VA_ACTIVE_CUSTOMER_DEALSTAGES, applied directly via HubSpot's deal
// search API rather than Neon (this only needs a list of deals, not a
// due-today trigger).
export async function fetchVaPipelineDeals(): Promise<VaPipelineDeal[]> {
  const result = (await hubspotFetch("/crm/v3/objects/deals/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: "EQ", value: VA_PIPELINE_ID },
            { propertyName: "dealstage", operator: "IN", values: VA_ACTIVE_CUSTOMER_DEALSTAGES },
          ],
        },
      ],
      properties: ["dealname", "dealstage", "billing_cycle", "next_renewal_date"],
      limit: 100,
    }),
  })) as {
    results: Array<{
      id: string;
      properties: { dealname?: string; dealstage?: string; billing_cycle?: string | null; next_renewal_date?: string | null };
    }>;
  };

  return result.results.map((deal) => ({
    dealId: deal.id,
    dealName: deal.properties.dealname ?? "",
    dealStage: deal.properties.dealstage ?? "",
    billingCycle: deal.properties.billing_cycle ?? null,
    nextRenewalDate: toIsoDate(deal.properties.next_renewal_date),
  }));
}

export interface VaDealWithLineItems extends VaPipelineDeal {
  lineItems: HubspotLineItem[];
  // Set instead of throwing when one of the line items is malformed, so one
  // bad record cannot take the whole listing down. The monthly classifier
  // treats it as "not monthly" (fails closed).
  lineItemsError?: string;
}

const HUBSPOT_BATCH_LIMIT = 100;

// Every active VA deal with all of its line items, in a handful of batch
// calls (deal search, one associations read, line-item reads in chunks of
// 100) rather than one round trip per line item. Used by the monthly
// billing classifier and the admin page.
export async function fetchVaDealsWithLineItems(): Promise<VaDealWithLineItems[]> {
  const deals = await fetchVaPipelineDeals();
  if (deals.length === 0) {
    return [];
  }

  const associations = (await hubspotFetch("/crm/v4/associations/deals/line_items/batch/read", {
    method: "POST",
    body: JSON.stringify({ inputs: deals.map((deal) => ({ id: deal.dealId })) }),
  })) as { results: Array<{ from: { id: string }; to: Array<{ toObjectId: number | string }> }> };

  // A deal with no line items is simply absent from the results (the
  // endpoint answers 207 Multi-Status), so default to an empty list.
  const lineItemIdsByDeal = new Map<string, string[]>();
  for (const row of associations.results) {
    lineItemIdsByDeal.set(row.from.id, row.to.map((t) => String(t.toObjectId)));
  }

  const allIds = [...new Set([...lineItemIdsByDeal.values()].flat())];
  const itemsById = new Map<string, HubspotLineItemResponse>();
  for (let i = 0; i < allIds.length; i += HUBSPOT_BATCH_LIMIT) {
    const batch = (await hubspotFetch("/crm/v3/objects/line_items/batch/read", {
      method: "POST",
      body: JSON.stringify({
        properties: LINE_ITEM_PROPERTIES,
        inputs: allIds.slice(i, i + HUBSPOT_BATCH_LIMIT).map((id) => ({ id })),
      }),
    })) as { results: HubspotLineItemResponse[] };
    for (const item of batch.results) {
      itemsById.set(item.id, item);
    }
  }

  return deals.map((deal) => {
    const raw = (lineItemIdsByDeal.get(deal.dealId) ?? [])
      .map((id) => itemsById.get(id))
      .filter((item): item is HubspotLineItemResponse => item !== undefined);
    try {
      return { ...deal, lineItems: raw.map((item) => parseLineItem(deal.dealId, item)) };
    } catch (err) {
      return { ...deal, lineItems: [], lineItemsError: err instanceof Error ? err.message : String(err) };
    }
  });
}

// HubSpot's default association type ID for "line item to deal".
const LINE_ITEM_TO_DEAL_ASSOCIATION_TYPE_ID = 20;

export interface RenewalLineItemInput {
  name: string;
  price: number;
  productId: string | null;
  billingStartDate: string; // YYYY-MM-DD, first day of the paid period
  datePaid: string; // YYYY-MM-DD
  months: number; // the paid term in months
}

// HubSpot's "Billing frequency" label for the terms it has a word for; any
// other term is written the way the team enters it: monthly frequency,
// quantity = months, price = the monthly share of the amount billed.
const TERM_FREQUENCY: Record<number, string> = { 1: "monthly", 3: "quarterly", 6: "per_six_months" };

// One complete "Renewal" line item per paid cycle — the same shape the team
// enters by hand (frequency, term, start = period start, Date Paid). HubSpot
// then calculates billing_term_end_date (the day the next cycle starts),
// which is what the classifier and the Neon mirror's due_on read. Returns
// the new line item's id.
export async function createRenewalLineItem(dealId: string, input: RenewalLineItemInput): Promise<string> {
  const frequency = TERM_FREQUENCY[input.months] ?? "monthly";
  const units = frequency === "monthly" ? input.months : 1;
  const created = (await hubspotFetch(`/crm/v3/objects/line_items`, {
    method: "POST",
    body: JSON.stringify({
      properties: {
        name: input.name,
        quantity: String(units),
        price: String(Math.round((input.price / units) * 100) / 100),
        recurringbillingfrequency: frequency,
        hs_recurring_billing_period: `P${input.months}M`,
        hs_recurring_billing_start_date: input.billingStartDate,
        date_renewed: input.datePaid,
        recurring_revenue_type: "Renewal",
        ...(input.productId ? { hs_product_id: input.productId } : {}),
      },
      associations: [
        {
          to: { id: dealId },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: LINE_ITEM_TO_DEAL_ASSOCIATION_TYPE_ID,
            },
          ],
        },
      ],
    }),
  })) as { id: string };

  return created.id;
}

export async function addLineItemToDeal(
  dealId: string,
  lineItem: { name: string; quantity: number; price: number },
): Promise<void> {
  await hubspotFetch(`/crm/v3/objects/line_items`, {
    method: "POST",
    body: JSON.stringify({
      properties: {
        name: lineItem.name,
        quantity: String(lineItem.quantity),
        price: String(lineItem.price),
      },
      associations: [
        {
          to: { id: dealId },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: LINE_ITEM_TO_DEAL_ASSOCIATION_TYPE_ID,
            },
          ],
        },
      ],
    }),
  });
}

// Admin page: set (or clear, with null) the deal's three Accountant Email
// fields — the addresses quotes and invoices are emailed to.
export async function updateDealAccountantEmails(dealId: string, emails: Array<string | null>): Promise<void> {
  await hubspotFetch(`/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: Object.fromEntries(ACCOUNTANT_EMAIL_PROPERTIES.map((name, i) => [name, emails[i] ?? ""])),
    }),
  });
}

export interface DealEmails {
  accountantEmails: Array<string | null>; // raw HubSpot values (fields 1–3), junk included, so the page can show what is there
}

// Admin page: every deal's Accountant Email fields in one batch call.
export async function fetchVaDealEmails(dealIds: string[]): Promise<Map<string, DealEmails>> {
  const emails = new Map<string, DealEmails>(dealIds.map((id) => [id, { accountantEmails: [null, null, null] }]));
  if (dealIds.length === 0) {
    return emails;
  }

  const deals = (await hubspotFetch("/crm/v3/objects/deals/batch/read", {
    method: "POST",
    body: JSON.stringify({ inputs: dealIds.map((id) => ({ id })), properties: [...ACCOUNTANT_EMAIL_PROPERTIES] }),
  })) as { results: Array<{ id: string; properties: Partial<Record<AccountantEmailProperty, string | null>> }> };
  for (const deal of deals.results) {
    const entry = emails.get(deal.id);
    if (entry) entry.accountantEmails = ACCOUNTANT_EMAIL_PROPERTIES.map((name) => deal.properties[name]?.trim() || null);
  }

  return emails;
}

// On payment: HubSpot's Next Renewal Date is what decides when a client is
// next quoted, so the automation moves it to the day after the paid period.
export async function updateDealNextRenewalDate(dealId: string, isoDate: string): Promise<void> {
  await hubspotFetch(`/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { next_renewal_date: isoDate } }),
  });
}
