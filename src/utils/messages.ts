import { servicePeriodFrom } from "./billingCycle.js";
import { escapeHtml } from "./escapeHtml.js";

// Client-facing wording, given by the business on 2026-09-28. One source
// for WhatsApp and email. The payment link is kept in the quote and in
// every reminder: without it the client has no way to pay.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(isoDate: string): string {
  return `${MONTHS[Number(isoDate.slice(5, 7)) - 1]}’${isoDate.slice(2, 4)}`;
}

// "September’26" for a one-month cycle, "October’26 to December’26" for a
// longer one (first and last month of the service period).
export function periodLabel(periodStart: string, months: number): string {
  if (months === 1) {
    return monthLabel(periodStart);
  }
  return `${monthLabel(periodStart)} to ${monthLabel(servicePeriodFrom(periodStart, months).end)}`;
}

// `subject` is what the document is for: a period label, or the service of
// a one-time quote. Null leaves it out (legacy rows have no period).
export function quoteMessage(subject: string | null, payLink: string | null): string[] {
  return [
    "Hi Team,",
    `Please find attached the quotation${subject ? ` for ${subject}` : ""}. Kindly arrange the payment and let us know once the payment has been completed.`,
    ...(payLink ? [`Pay online: ${payLink}`] : []),
    "Thank you!",
  ];
}

export function invoiceMessage(subject: string | null): string[] {
  return [
    "Hi Team,",
    "Thank you for the payment. We acknowledge receipt of the same.",
    `Please find attached the invoice${subject ? ` for ${subject}` : ""} for your records.`,
    "Thank you!",
  ];
}

export function reminderMessage(stage: 1 | 2 | 3, payLink: string): string[] {
  if (stage === 1) {
    return [
      "Hi Team, just a gentle reminder regarding the pending payment.",
      "Request you to kindly arrange the payment at your earliest convenience. Please let us know if the payment has already been processed.",
      `Pay online: ${payLink}`,
      "Thank you!",
    ];
  }
  if (stage === 2) {
    return [
      "Hi Team, following up on the pending payment.",
      "The payment is still pending. Kindly arrange the payment and share the confirmation once completed.",
      "Please let us know if there is any issue with the payment.",
      `Pay online: ${payLink}`,
    ];
  }
  return [
    "Hi Team, this is a final follow-up regarding the pending payment.",
    "Request you to kindly clear the outstanding payment at the earliest and share the payment confirmation once done.",
    "If the payment has already been processed, please share the transaction details so we can update our records. Thank you.",
    `Pay online: ${payLink}`,
  ];
}

export function asWhatsapp(lines: string[]): string {
  return lines.join("\n");
}

// Email bodies are HTML: every line is escaped, so typed text stays text.
export function asEmailHtml(lines: string[]): string {
  return lines.map(escapeHtml).join("<br><br>");
}

// What a one-time quote is for: the service, with its narration if any.
export function oneTimeSubject(service: string, narration: string | null): string {
  return `${service}${narration ? ` (${narration})` : ""}`;
}
