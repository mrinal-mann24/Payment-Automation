import { config } from "../config.js";

const HUBSPOT_BASE_URL = "https://api.hubapi.com";

export interface HubspotLineItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

export interface HubspotDeal {
  dealId: string;
  dealName: string;
  billingPeriod: string;
  contactEmail: string;
  contactName: string;
  contactPhone: string | null;
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

export async function fetchDealWithLineItemsAndContact(dealId: string): Promise<HubspotDeal> {
  const deal = (await hubspotFetch(
    `/crm/v3/objects/deals/${dealId}?properties=dealname,billing_cycle,next_renewal_date&associations=line_items,contacts`,
  )) as HubspotDealResponse;

  const lineItemIds = deal.associations?.["line items"]?.results.map((r) => r.id) ?? [];
  const contactId = deal.associations?.contacts?.results[0]?.id;

  if (!contactId) {
    throw new Error(`HubSpot deal ${dealId} has no associated contact`);
  }

  const [lineItems, contact] = await Promise.all([
    Promise.all(
      lineItemIds.map((id) =>
        hubspotFetch(
          `/crm/v3/objects/line_items/${id}?properties=name,quantity,price`,
        ) as Promise<HubspotLineItemResponse>,
      ),
    ),
    hubspotFetch(
      `/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,phone`,
    ) as Promise<HubspotContactResponse>,
  ]);

  if (!contact.properties.email) {
    throw new Error(`HubSpot contact ${contactId} for deal ${dealId} has no email`);
  }

  const billingCycle = deal.properties.billing_cycle;
  const nextRenewalDate = deal.properties.next_renewal_date;
  if (!billingCycle || !nextRenewalDate) {
    throw new Error(
      `HubSpot deal ${dealId} is missing billing_cycle or next_renewal_date`,
    );
  }
  const billingPeriod = `${billingCycle}-${nextRenewalDate}`;

  return {
    dealId: deal.id,
    dealName: deal.properties.dealname ?? "",
    billingPeriod,
    contactEmail: contact.properties.email,
    contactName: [contact.properties.firstname, contact.properties.lastname]
      .filter(Boolean)
      .join(" "),
    contactPhone: contact.properties.phone ?? null,
    lineItems: lineItems.map((item) => ({
      id: item.id,
      name: item.properties.name ?? "",
      quantity: Number(item.properties.quantity ?? 1),
      price: Number(item.properties.price ?? 0),
    })),
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

// HubSpot's default association type ID for "line item to deal".
const LINE_ITEM_TO_DEAL_ASSOCIATION_TYPE_ID = 20;

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
