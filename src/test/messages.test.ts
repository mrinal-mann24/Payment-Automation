import { describe, expect, it } from "vitest";
import {
  asEmailHtml,
  asWhatsapp,
  invoiceMessage,
  monthYearLabel,
  periodLabel,
  quoteMessage,
  reminderMessage,
} from "../utils/messages.js";

describe("periodLabel", () => {
  it("names the month of a one-month cycle and the first and last month of a longer one", () => {
    expect(periodLabel("2026-09-01", 1)).toBe("September’26");
    expect(periodLabel("2026-10-09", 1)).toBe("October’26");
    expect(periodLabel("2026-10-01", 3)).toBe("October’26 to December’26");
    expect(periodLabel("2026-11-01", 3)).toBe("November’26 to January’27");
  });
});

describe("quote and invoice messages", () => {
  it("uses the business wording for the quote and keeps the payment link", () => {
    expect(asWhatsapp(quoteMessage("September’26", "https://rzp.io/i/1"))).toBe(
      [
        "Hi Team,",
        "Please find attached the quotation for September’26. Kindly arrange the payment and let us know once the payment has been completed.",
        "Pay online: https://rzp.io/i/1",
        "Thank you!",
      ].join("\n"),
    );
  });

  it("uses the business wording for the invoice", () => {
    expect(asWhatsapp(invoiceMessage("September’26"))).toBe(
      [
        "Hi Team,",
        "Thank you for the payment. We acknowledge receipt of the same.",
        "Please find attached the invoice for September’26 for your records.",
        "Thank you!",
      ].join("\n"),
    );
  });

  it("leaves the period out when there is none, and escapes typed text in the email form", () => {
    expect(asWhatsapp(quoteMessage(null, null))).toBe(
      "Hi Team,\nPlease find attached the quotation. Kindly arrange the payment and let us know once the payment has been completed.\nThank you!",
    );
    expect(asEmailHtml(invoiceMessage("Audit <b>2026</b>"))).toContain("the invoice for Audit &lt;b&gt;2026&lt;/b&gt; for your records.");
    expect(asEmailHtml(invoiceMessage("x"))).toContain("Hi Team,<br><br>Thank you for the payment.");
  });

  it("greets the client by name when one is given, instead of the Team default", () => {
    expect(asWhatsapp(quoteMessage("September’26", "https://rzp.io/i/1", "Rajesh"))).toContain("Hi Rajesh,");
    expect(asWhatsapp(quoteMessage("September’26", "https://rzp.io/i/1", null))).toContain("Hi Team,");
    expect(asWhatsapp(invoiceMessage("September’26", "Rajesh"))).toContain("Hi Rajesh,");
    expect(asWhatsapp(invoiceMessage("September’26"))).toContain("Hi Team,");
  });
});

describe("monthYearLabel", () => {
  it("is the full month name and year", () => {
    expect(monthYearLabel("2026-07-01")).toBe("July 2026");
    expect(monthYearLabel("2026-01-15")).toBe("January 2026");
  });
});

describe("reminderMessage", () => {
  it("uses the new business wording for day 5 (stage 1), with the payment link appended", () => {
    const first = asWhatsapp(reminderMessage(1, "https://rzp.io/i/1"));
    expect(first).toBe(
      [
        "Hi Team, a gentle reminder to kindly clear the outstanding amount in your next payment cycle. Thank you!",
        "Pay online: https://rzp.io/i/1",
      ].join("\n"),
    );
  });

  it("uses the same new wording for day 9 (stage 2) and day 12 (stage 3) — byte-identical", () => {
    const second = reminderMessage(2, "https://rzp.io/i/1");
    const third = reminderMessage(3, "https://rzp.io/i/1");
    expect(second).toEqual(third);
    expect(asWhatsapp(second)).toBe(
      [
        "Hi Team, following up regarding the pending payment.",
        "Request you to kindly clear the outstanding amount at the earliest and share the payment confirmation once done.",
        "If the payment has already been processed, please share the transaction details so we can update our records. Thank you.",
        "Pay online: https://rzp.io/i/1",
      ].join("\n"),
    );
  });

  it("greets the client by name when one is given", () => {
    expect(asWhatsapp(reminderMessage(1, "https://rzp.io/i/1", "Rajesh"))).toContain(
      "Hi Rajesh, a gentle reminder to kindly clear the outstanding amount",
    );
    expect(asWhatsapp(reminderMessage(2, "https://rzp.io/i/1", "Rajesh"))).toContain("Hi Rajesh, following up regarding the pending payment.");
  });

  it("includes the arrears line, right before the payment link, only when one is given", () => {
    const withArrears = asWhatsapp(
      reminderMessage(1, "https://rzp.io/i/1", null, "You currently have pending payments for the last 3 months (since July 2026)."),
    );
    expect(withArrears).toBe(
      [
        "Hi Team, a gentle reminder to kindly clear the outstanding amount in your next payment cycle. Thank you!",
        "You currently have pending payments for the last 3 months (since July 2026).",
        "Pay online: https://rzp.io/i/1",
      ].join("\n"),
    );
    expect(asWhatsapp(reminderMessage(1, "https://rzp.io/i/1"))).not.toContain("pending payments for the last");
  });
});
