import { config } from "../config.js";

const PERISKOPE_BASE_URL = "https://api.periskope.app/v1";

function toChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Bare 10-digit numbers are Indian local numbers with no country code
  // (e.g. HubSpot's `phone` property) — prepend 91 so the WhatsApp JID
  // resolves to the right country instead of an arbitrary short code.
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits;
  return `${withCountryCode}@c.us`;
}

export async function sendTextMessage(phone: string, message: string): Promise<void> {
  const response = await fetch(`${PERISKOPE_BASE_URL}/message/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.periskope.bearerToken}`,
      "x-phone": config.periskope.xPhone,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: toChatId(phone),
      message,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Periskope API error ${response.status}: ${body}`);
  }
}

export async function sendDocumentMessage(
  phone: string,
  message: string,
  document: { base64: string; filename: string; mimetype: string },
): Promise<void> {
  const response = await fetch(`${PERISKOPE_BASE_URL}/message/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.periskope.bearerToken}`,
      "x-phone": config.periskope.xPhone,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: toChatId(phone),
      message,
      media: {
        type: "document",
        filedata: document.base64,
        filename: document.filename,
        mimetype: document.mimetype,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Periskope API error ${response.status}: ${body}`);
  }
}
