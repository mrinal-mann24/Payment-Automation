import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidWhatsappRecipient, sendDocumentMessage, sendTextMessage } from "../clients/periskope.js";

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.PERISKOPE_BEARER_TOKEN = "test-token";
  process.env.PERISKOPE_X_PHONE = "911234567890";
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("sendDocumentMessage", () => {
  it("sends a document message with chat_id derived from the phone number", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "queued" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendDocumentMessage("+91 98765 43210", "hello", {
      base64: "ZmFrZQ==",
      filename: "quote.pdf",
      mimetype: "application/pdf",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/message/send");
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("919876543210@c.us");
    expect(body.media).toEqual({
      type: "document",
      filedata: "ZmFrZQ==",
      filename: "quote.pdf",
      mimetype: "application/pdf",
    });
  });

  it("prepends 91 to a bare 10-digit Indian number (no country code)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "queued" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendDocumentMessage("6372161101", "hello", {
      base64: "ZmFrZQ==",
      filename: "quote.pdf",
      mimetype: "application/pdf",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("916372161101@c.us");
  });

  it("throws when the Periskope API returns an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      sendDocumentMessage("919876543210", "hello", {
        base64: "ZmFrZQ==",
        filename: "quote.pdf",
        mimetype: "application/pdf",
      }),
    ).rejects.toThrow("Periskope API error 401");
  });
});

describe("group recipients", () => {
  it("sends to an 18-digit group id as <id>@g.us and passes an existing @g.us id through", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "queued" }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendTextMessage("120363012345678901", "hello");
    await sendTextMessage("919876543210-1612345678@g.us", "hello");

    const chatIds = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).chat_id);
    expect(chatIds).toEqual(["120363012345678901@g.us", "919876543210-1612345678@g.us"]);
  });

  it("rejects a value that is neither a phone number nor a group id", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(sendTextMessage("123456789012345", "hello")).rejects.toThrow(/Not a valid WhatsApp/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isValidWhatsappRecipient accepts phones and group ids only", () => {
    expect(isValidWhatsappRecipient("120363012345678901")).toBe(true);
    expect(isValidWhatsappRecipient("919876543210-1612345678@g.us")).toBe(true);
    expect(isValidWhatsappRecipient("9876543210")).toBe(true);
    expect(isValidWhatsappRecipient("919876543210")).toBe(true);
    expect(isValidWhatsappRecipient("123456789012345")).toBe(false);
    expect(isValidWhatsappRecipient("")).toBe(false);
  });
});
