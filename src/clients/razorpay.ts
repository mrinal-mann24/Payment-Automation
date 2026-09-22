import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const RAZORPAY_BASE_URL = "https://api.razorpay.com/v1";

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const expected = createHmac("sha256", config.razorpay.webhookSecret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

function authHeader(): string {
  const credentials = `${config.razorpay.keyId}:${config.razorpay.keySecret}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

async function razorpayFetch(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = await response.json();
  return { status: response.status, body };
}

interface RazorpayPaymentLink {
  id: string;
  short_url: string;
  reference_id: string | null;
}

interface RazorpayPaymentLinkListResponse {
  items: RazorpayPaymentLink[];
}

export async function createPaymentLink(
  referenceId: string,
  amountPaise: number,
  description: string,
): Promise<{ paymentLinkId: string; shortUrl: string }> {
  const { status, body } = await razorpayFetch("/payment_links", {
    method: "POST",
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      reference_id: referenceId,
      description,
    }),
  });

  if (status === 400 && isReferenceIdExistsError(body)) {
    return fetchPaymentLinkByReferenceId(referenceId);
  }

  if (status < 200 || status >= 300) {
    throw new Error(`Razorpay API error ${status}: ${JSON.stringify(body)}`);
  }

  const link = body as RazorpayPaymentLink;
  return { paymentLinkId: link.id, shortUrl: link.short_url };
}

function isReferenceIdExistsError(body: unknown): boolean {
  const description = (body as { error?: { description?: string } })?.error?.description ?? "";
  return description.toLowerCase().includes("reference_id") && description.toLowerCase().includes("already exists");
}

export interface RazorpayPaymentLinkDetails {
  id: string;
  status: string; // created | partially_paid | paid | cancelled | expired
  short_url: string;
}

export async function fetchPaymentLink(paymentLinkId: string): Promise<RazorpayPaymentLinkDetails> {
  const { status, body } = await razorpayFetch(`/payment_links/${paymentLinkId}`);

  if (status < 200 || status >= 300) {
    throw new Error(`Razorpay API error ${status}: ${JSON.stringify(body)}`);
  }

  return body as RazorpayPaymentLinkDetails;
}

export type CancelPaymentLinkOutcome = "cancelled" | "already_cancelled" | "already_paid";

// Used when a cycle is settled outside Razorpay (bank transfer) so the
// client cannot also pay the link. Razorpay refuses to cancel a link that
// is no longer open; the link's current status says why.
export async function cancelPaymentLink(paymentLinkId: string): Promise<CancelPaymentLinkOutcome> {
  const { status, body } = await razorpayFetch(`/payment_links/${paymentLinkId}/cancel`, { method: "POST" });

  if (status >= 200 && status < 300) {
    return "cancelled";
  }

  const link = await fetchPaymentLink(paymentLinkId);
  if (link.status === "paid") {
    return "already_paid";
  }
  if (link.status === "cancelled" || link.status === "expired") {
    return "already_cancelled";
  }
  throw new Error(`Razorpay API error ${status}: ${JSON.stringify(body)}`);
}

async function fetchPaymentLinkByReferenceId(
  referenceId: string,
): Promise<{ paymentLinkId: string; shortUrl: string }> {
  const params = new URLSearchParams({ reference_id: referenceId });
  const { status, body } = await razorpayFetch(`/payment_links?${params.toString()}`);

  if (status < 200 || status >= 300) {
    throw new Error(`Razorpay API error ${status}: ${JSON.stringify(body)}`);
  }

  const { items } = body as RazorpayPaymentLinkListResponse;
  const existing = items.find((item) => item.reference_id === referenceId);
  if (!existing) {
    throw new Error(
      `Razorpay reported reference_id ${referenceId} already exists but it could not be found via fetch`,
    );
  }

  return { paymentLinkId: existing.id, shortUrl: existing.short_url };
}
