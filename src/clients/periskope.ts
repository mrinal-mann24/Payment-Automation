import { config } from "../config.js";

const PERISKOPE_BASE_URL = "https://api.periskope.app/v1";

// A malformed HubSpot phone value (extension notes, wrong digit count,
// etc.) must not silently resolve to some other real WhatsApp number —
// only a bare 10-digit Indian local number or a 12-digit one already
// carrying the 91 country code is accepted.
export function isValidWhatsappPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 || (digits.length === 12 && digits.startsWith("91"));
}

const GROUP_JID_SUFFIX = "@g.us";

// A WhatsApp group id is either a bare 18-digit id (how the clients table
// stores them) or a full group JID already ending in "@g.us" (older ids look
// like "<digits>-<digits>@g.us"). A phone has at most 12 digits, so the two
// can never be confused.
export function isValidWhatsappGroupId(value: string): boolean {
  return value.endsWith(GROUP_JID_SUFFIX) || /^\d{18}$/.test(value);
}

export function isValidWhatsappRecipient(value: string): boolean {
  return isValidWhatsappGroupId(value) || isValidWhatsappPhone(value);
}

function toChatId(recipient: string): string {
  if (recipient.endsWith(GROUP_JID_SUFFIX)) {
    return recipient;
  }
  if (isValidWhatsappGroupId(recipient)) {
    return `${recipient}${GROUP_JID_SUFFIX}`;
  }
  if (!isValidWhatsappPhone(recipient)) {
    throw new Error(`Not a valid WhatsApp phone number or group id: ${recipient}`);
  }
  const digits = recipient.replace(/\D/g, "");
  // Bare 10-digit numbers are Indian local numbers with no country code
  // (e.g. HubSpot's `phone` property) — prepend 91 so the WhatsApp JID
  // resolves to the right country instead of an arbitrary short code.
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits;
  return `${withCountryCode}@c.us`;
}

// `recipient` is a phone number or a group id (see toChatId).
export async function sendTextMessage(recipient: string, message: string): Promise<void> {
  const response = await fetch(`${PERISKOPE_BASE_URL}/message/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.periskope.bearerToken}`,
      "x-phone": config.periskope.xPhone,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: toChatId(recipient),
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
