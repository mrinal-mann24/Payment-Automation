import type { RenewalJob } from "../repositories/renewalJobs.js";
import { daysBetween } from "./billingCycle.js";
import { periodLabel } from "./messages.js";

export type ExportJob = Pick<
  RenewalJob,
  | "hubspot_deal_id"
  | "zoho_estimate_number"
  | "zoho_estimate_total"
  | "zoho_invoice_number"
  | "paid_at"
  | "payment_amount"
  | "payment_date"
  | "payment_method"
  | "payment_reference"
  | "service_period_start"
  | "term_months"
  | "razorpay_short_url"
  | "reminder_1_sent_at"
  | "reminder_2_sent_at"
  | "reminder_3_sent_at"
>;

export interface ExportRow {
  category: "Paid" | "Unpaid - overdue";
  client: string;
  period: string;
  quoteNumber: string;
  quoteTotal: number | "";
  invoiceNumber: string;
  amountPaid: number | "";
  paymentDate: string;
  paymentMethod: string;
  paymentReference: string;
  dueDate: string;
  daysOverdue: number | "";
  remindersSent: number;
  paymentLink: string;
}

const COLUMNS: Array<[string, keyof ExportRow]> = [
  ["Category", "category"],
  ["Client", "client"],
  ["Period", "period"],
  ["Quote number", "quoteNumber"],
  ["Quote total", "quoteTotal"],
  ["Invoice number", "invoiceNumber"],
  ["Amount paid", "amountPaid"],
  ["Payment date", "paymentDate"],
  ["Payment method", "paymentMethod"],
  ["Payment reference", "paymentReference"],
  ["Due date", "dueDate"],
  ["Days overdue", "daysOverdue"],
  ["Reminders sent", "remindersSent"],
  ["Payment link", "paymentLink"],
];

function num(value: number | string | null | undefined): number | "" {
  return value === null || value === undefined ? "" : Number(value);
}

// Two categories: cycles that have been paid, and unpaid cycles whose due
// date (the cycle's start date) has passed. An unpaid cycle due today or
// later, and legacy rows with no cycle start, are left out.
export function buildExportRows(jobs: ExportJob[], clientNames: Map<string, string>, today: string): ExportRow[] {
  const rows: ExportRow[] = [];

  for (const job of jobs) {
    const client = clientNames.get(job.hubspot_deal_id) ?? job.hubspot_deal_id;
    const period = job.service_period_start ? periodLabel(job.service_period_start, job.term_months ?? 1) : "";
    const remindersSent = [job.reminder_1_sent_at, job.reminder_2_sent_at, job.reminder_3_sent_at].filter(Boolean).length;
    const base = {
      client,
      period,
      quoteNumber: job.zoho_estimate_number ?? "",
      quoteTotal: num(job.zoho_estimate_total),
      remindersSent,
    };

    if (job.paid_at) {
      rows.push({
        ...base,
        category: "Paid",
        invoiceNumber: job.zoho_invoice_number ?? "",
        amountPaid: num(job.payment_amount),
        paymentDate: job.payment_date ?? "",
        paymentMethod: job.payment_method ?? "",
        paymentReference: job.payment_reference ?? "",
        dueDate: "",
        daysOverdue: "",
        paymentLink: "",
      });
      continue;
    }

    if (!job.service_period_start) continue;
    const daysOverdue = daysBetween(job.service_period_start, today);
    if (daysOverdue <= 0) continue;
    rows.push({
      ...base,
      category: "Unpaid - overdue",
      invoiceNumber: "",
      amountPaid: "",
      paymentDate: "",
      paymentMethod: "",
      paymentReference: "",
      dueDate: job.service_period_start,
      daysOverdue,
      paymentLink: job.razorpay_short_url ?? "",
    });
  }

  const paidRows = rows.filter((r) => r.category === "Paid");
  const unpaidRows = rows.filter((r) => r.category !== "Paid");
  paidRows.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || a.client.localeCompare(b.client));
  unpaidRows.sort((a, b) => Number(b.daysOverdue) - Number(a.daysOverdue) || a.client.localeCompare(b.client));
  return [...paidRows, ...unpaidRows];
}

// A text cell that starts with = + - @ would run as a formula when the file
// is opened in Excel; deal names and payment references are typed by others.
function cell(value: string | number): string {
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// UTF-8 with a byte-order mark so Excel reads the ’ in period labels.
export function exportCsv(rows: ExportRow[]): string {
  const lines = [COLUMNS.map(([header]) => header).join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map(([, key]) => cell(row[key])).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
