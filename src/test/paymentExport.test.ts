import { describe, expect, it } from "vitest";
import { buildExportRows, exportCsv, type ExportJob } from "../utils/paymentExport.js";

const TODAY = "2026-10-07";

const unpaid: ExportJob = {
  hubspot_deal_id: "deal-1",
  zoho_estimate_number: "QT-000532",
  zoho_estimate_total: 5400,
  zoho_invoice_number: null,
  paid_at: null,
  payment_amount: null,
  payment_date: null,
  payment_method: null,
  payment_reference: null,
  service_period_start: "2026-10-01",
  term_months: 1,
  razorpay_short_url: "https://rzp.io/rzp/abc",
  reminder_1_sent_at: "2026-10-05T06:30:03Z",
  reminder_2_sent_at: null,
  reminder_3_sent_at: null,
};

const paid: ExportJob = {
  ...unpaid,
  hubspot_deal_id: "deal-2",
  zoho_estimate_number: "QT-000528",
  zoho_estimate_total: 3240,
  zoho_invoice_number: "INV-10785",
  paid_at: "2026-10-05T07:18:29Z",
  payment_amount: 3240,
  payment_date: "2026-10-05",
  payment_method: "razorpay",
  payment_reference: "pay_RZ123",
  razorpay_short_url: "https://rzp.io/rzp/paid",
  reminder_1_sent_at: null,
};

const names = new Map([
  ["deal-1", "Debu Seth_AiA"],
  ["deal-2", "Leon Enterprises_VA"],
]);

describe("buildExportRows", () => {
  it("lists a paid cycle with its invoice and payment details", () => {
    const [row] = buildExportRows([paid], names, TODAY);

    expect(row).toMatchObject({
      category: "Paid",
      client: "Leon Enterprises_VA",
      period: "October’26",
      quoteNumber: "QT-000528",
      quoteTotal: 3240,
      invoiceNumber: "INV-10785",
      amountPaid: 3240,
      paymentDate: "2026-10-05",
      paymentMethod: "razorpay",
      paymentReference: "pay_RZ123",
      paymentLink: "",
    });
  });

  it("lists an unpaid cycle past its due date with days overdue, reminders sent and the payment link", () => {
    const [row] = buildExportRows([unpaid], names, TODAY);

    expect(row).toMatchObject({
      category: "Unpaid - overdue",
      client: "Debu Seth_AiA",
      quoteNumber: "QT-000532",
      quoteTotal: 5400,
      dueDate: "2026-10-01",
      daysOverdue: 6,
      remindersSent: 1,
      paymentLink: "https://rzp.io/rzp/abc",
      invoiceNumber: "",
      amountPaid: "",
    });
  });

  it("leaves out an unpaid cycle whose due date has not passed yet, and legacy rows with no cycle start", () => {
    const dueToday = { ...unpaid, service_period_start: TODAY };
    const future = { ...unpaid, service_period_start: "2026-11-01" };
    const legacy = { ...unpaid, service_period_start: null };

    expect(buildExportRows([dueToday, future, legacy], names, TODAY)).toEqual([]);
  });

  it("puts paid first (newest payment first), then unpaid with the most overdue first", () => {
    const olderPaid = { ...paid, hubspot_deal_id: "deal-3", payment_date: "2026-10-02" };
    const lessOverdue = { ...unpaid, hubspot_deal_id: "deal-4", service_period_start: "2026-10-05" };

    const rows = buildExportRows([lessOverdue, olderPaid, unpaid, paid], names, TODAY);

    expect(rows.map((r) => [r.category, r.daysOverdue || r.paymentDate])).toEqual([
      ["Paid", "2026-10-05"],
      ["Paid", "2026-10-02"],
      ["Unpaid - overdue", 6],
      ["Unpaid - overdue", 2],
    ]);
  });

  it("falls back to the deal id when the deal has no name", () => {
    const [row] = buildExportRows([{ ...unpaid, hubspot_deal_id: "deal-9" }], names, TODAY);

    expect(row!.client).toBe("deal-9");
  });
});

describe("exportCsv", () => {
  it("starts with a byte-order mark and a header row so Excel reads the rupee sign and quotes correctly", () => {
    const csv = exportCsv(buildExportRows([paid, unpaid], names, TODAY));
    const lines = csv.replace(/^﻿/, "").split("\r\n");

    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe(
      "Category,Client,Period,Quote number,Quote total,Invoice number,Amount paid,Payment date,Payment method,Payment reference,Due date,Days overdue,Reminders sent,Payment link",
    );
    expect(lines[1]).toBe("Paid,Leon Enterprises_VA,October’26,QT-000528,3240,INV-10785,3240,2026-10-05,razorpay,pay_RZ123,,,0,");
    expect(lines[2]).toBe(
      "Unpaid - overdue,Debu Seth_AiA,October’26,QT-000532,5400,,,,,,2026-10-01,6,1,https://rzp.io/rzp/abc",
    );
  });

  it("quotes cells that contain commas, quotes or line breaks", () => {
    const tricky = new Map([["deal-1", 'Acme, "Pvt" Ltd\nUnit 2']]);

    const csv = exportCsv(buildExportRows([unpaid], tricky, TODAY));

    expect(csv).toContain('"Acme, ""Pvt"" Ltd\nUnit 2"');
  });

  it("defuses spreadsheet formulas typed into a deal name or payment reference", () => {
    const evil = new Map([["deal-2", '=HYPERLINK("http://x")']]);
    const csv = exportCsv(buildExportRows([{ ...paid, payment_reference: "+cmd|' /C calc'!A0" }], evil, TODAY));

    expect(csv).toContain('"\'=HYPERLINK(""http://x"")"');
    expect(csv).toContain("'+cmd|' /C calc'!A0");
  });
});
