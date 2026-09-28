import { describe, expect, it } from "vitest";
import { asEmailHtml, asWhatsapp, invoiceMessage, periodLabel, quoteMessage, reminderMessage } from "../utils/messages.js";

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
});

describe("reminderMessage", () => {
  it("uses the business wording for each of the three reminders, with the payment link", () => {
    const first = asWhatsapp(reminderMessage(1, "https://rzp.io/i/1"));
    expect(first).toContain("Hi Team, just a gentle reminder regarding the pending payment.");
    expect(first).toContain("Request you to kindly arrange the payment at your earliest convenience. Please let us know if the payment has already been processed.");
    expect(first.endsWith("Pay online: https://rzp.io/i/1\nThank you!")).toBe(true);

    const second = asWhatsapp(reminderMessage(2, "https://rzp.io/i/1"));
    expect(second).toContain("Hi Team, following up on the pending payment.");
    expect(second).toContain("The payment is still pending. Kindly arrange the payment and share the confirmation once completed.");
    expect(second).toContain("Please let us know if there is any issue with the payment.");
    expect(second).toContain("Pay online: https://rzp.io/i/1");

    const third = asWhatsapp(reminderMessage(3, "https://rzp.io/i/1"));
    expect(third).toContain("Hi Team, this is a final follow-up regarding the pending payment.");
    expect(third).toContain("Request you to kindly clear the outstanding payment at the earliest and share the payment confirmation once done.");
    expect(third).toContain("If the payment has already been processed, please share the transaction details so we can update our records. Thank you.");
    expect(third).toContain("Pay online: https://rzp.io/i/1");
  });
});
