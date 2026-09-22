import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelPaymentLink, createPaymentLink, fetchPaymentLink, verifyWebhookSignature } from "../clients/razorpay.js";

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "rzp_test_webhook_secret";
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("createPaymentLink", () => {
  it("creates a new payment link when reference_id does not already exist", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ id: "plink_new123", short_url: "https://rzp.io/i/new123" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await createPaymentLink("EST-000123", 100000, "Renewal payment");

    expect(result).toEqual({ paymentLinkId: "plink_new123", shortUrl: "https://rzp.io/i/new123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches and reuses the existing payment link when reference_id already exists (REQ-2.3)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 400,
        json: async () => ({
          error: {
            description:
              "payment link with given reference_id: EST-000123 already exists. Please create a Payment Link with a different reference_id",
          },
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          items: [
            {
              id: "plink_existing456",
              short_url: "https://rzp.io/i/existing456",
              reference_id: "EST-000123",
            },
          ],
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await createPaymentLink("EST-000123", 100000, "Renewal payment");

    expect(result).toEqual({
      paymentLinkId: "plink_existing456",
      shortUrl: "https://rzp.io/i/existing456",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/payment_links?reference_id=EST-000123");
  });

  it("throws on other Razorpay API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 500,
      json: async () => ({ error: { description: "Internal server error" } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(createPaymentLink("EST-000999", 100000, "Renewal payment")).rejects.toThrow(
      "Razorpay API error 500",
    );
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a signature computed with the configured webhook secret (REQ-4.1)", () => {
    const rawBody = JSON.stringify({ event: "payment_link.paid" });
    const signature = createHmac("sha256", "rzp_test_webhook_secret").update(rawBody).digest("hex");

    expect(verifyWebhookSignature(rawBody, signature)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret (REQ-4.2)", () => {
    const rawBody = JSON.stringify({ event: "payment_link.paid" });
    const signature = createHmac("sha256", "wrong_secret").update(rawBody).digest("hex");

    expect(verifyWebhookSignature(rawBody, signature)).toBe(false);
  });

  it("rejects a signature for a different body (REQ-4.2)", () => {
    const signature = createHmac("sha256", "rzp_test_webhook_secret")
      .update(JSON.stringify({ event: "payment_link.paid" }))
      .digest("hex");

    expect(verifyWebhookSignature(JSON.stringify({ event: "tampered" }), signature)).toBe(false);
  });
});

describe("cancelPaymentLink / fetchPaymentLink", () => {
  const linkWithStatus = (status: string) => ({
    status: 200,
    json: async () => ({ id: "plink_1", status, short_url: "https://rzp.io/i/1" }),
  });

  it("cancels an open link", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(linkWithStatus("cancelled"));
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await cancelPaymentLink("plink_1")).toBe("cancelled");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/payment_links/plink_1/cancel");
  });

  it("tolerates a link that was already cancelled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 400, json: async () => ({ error: { description: "already cancelled" } }) })
      .mockResolvedValueOnce(linkWithStatus("cancelled"));
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await cancelPaymentLink("plink_1")).toBe("already_cancelled");
  });

  it("reports a link that was already paid (possible double payment) without throwing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 400, json: async () => ({ error: { description: "cannot cancel" } }) })
      .mockResolvedValueOnce(linkWithStatus("paid"));
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await cancelPaymentLink("plink_1")).toBe("already_paid");
  });

  it("throws for any other failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, json: async () => ({ error: { description: "server error" } }) })
      .mockResolvedValueOnce(linkWithStatus("created"));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(cancelPaymentLink("plink_1")).rejects.toThrow(/Razorpay API error 500/);
  });

  it("fetchPaymentLink returns the current link status", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(linkWithStatus("paid")) as unknown as typeof fetch;

    expect(await fetchPaymentLink("plink_1")).toMatchObject({ status: "paid" });
  });
});
