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

// "July 2026" — full month name and year, for the arrears line. Distinct
// from monthLabel's apostrophe-abbreviated form used in quote subjects.
export function monthYearLabel(isoDate: string): string {
  return `${MONTHS[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(0, 4)}`;
}

// "Hi <name>" when a per-client name is set (admin-entered, 2026-09-29
// decision), else the "Hi Team" default.
function greeting(name: string | null | undefined): string {
  return `Hi ${name || "Team"}`;
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
// `name`, when set, replaces the "Hi Team" default with "Hi <name>".
export function quoteMessage(subject: string | null, payLink: string | null, name: string | null = null): string[] {
  return [
    `${greeting(name)},`,
    `Please find attached the quotation${subject ? ` for ${subject}` : ""}. Kindly arrange the payment and let us know once the payment has been completed.`,
    ...(payLink ? [`Pay online: ${payLink}`] : []),
    "Thank you!",
  ];
}

export function invoiceMessage(subject: string | null, name: string | null = null): string[] {
  return [
    `${greeting(name)},`,
    "Thank you for the payment. We acknowledge receipt of the same.",
    `Please find attached the invoice${subject ? ` for ${subject}` : ""} for your records.`,
    "Thank you!",
  ];
}

// Business wording, 2026-09-29 (replaces the earlier 5/7/9-stage copy):
// stage 1 fires on day 5, stages 2 and 3 (days 9 and 12) share identical
// text. `arrearsLine`, when given, is inserted after the given copy and
// before the payment link — see monthsPendingSince/sendOverdueReminder.ts.
export function reminderMessage(
  stage: 1 | 2 | 3,
  payLink: string,
  name: string | null = null,
  arrearsLine: string | null = null,
): string[] {
  const body =
    stage === 1
      ? [`${greeting(name)}, a gentle reminder to kindly clear the outstanding amount in your next payment cycle. Thank you!`]
      : [
          `${greeting(name)}, following up regarding the pending payment.`,
          "Request you to kindly clear the outstanding amount at the earliest and share the payment confirmation once done.",
          "If the payment has already been processed, please share the transaction details so we can update our records. Thank you.",
        ];
  return [...body, ...(arrearsLine ? [arrearsLine] : []), `Pay online: ${payLink}`];
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
