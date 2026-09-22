// IST is a fixed UTC+05:30 with no DST, so a plain offset is exact. Every
// function here works in UTC arithmetic on purpose: the container runs in
// UTC and the dev machine in IST, so local-time Date getters would give
// different answers in the two places.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The IST calendar date (YYYY-MM-DD) for an instant.
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// The IST calendar month (YYYY-MM) for an instant — the billing_period key
// of a monthly renewal_jobs row.
export function billingMonthKey(now: Date = new Date()): string {
  return istToday(now).slice(0, 7);
}

export function istDayOfMonth(now: Date = new Date()): number {
  return Number(istToday(now).slice(8, 10));
}

export interface ServicePeriod {
  start: string; // YYYY-MM-DD, first day of the month
  end: string; // YYYY-MM-DD, last day of the month (inclusive)
  narration: string; // e.g. "Service period: 1 October 2026 to 31 October 2026"
}

export function servicePeriod(monthKey: string): ServicePeriod {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`Billing month key must be YYYY-MM, got "${monthKey}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthName = MONTH_NAMES[month - 1];

  return {
    start: `${monthKey}-01`,
    end: `${monthKey}-${String(lastDay).padStart(2, "0")}`,
    narration: `Service period: 1 ${monthName} ${year} to ${lastDay} ${monthName} ${year}`,
  };
}

export interface BillingCycle {
  key: string; // YYYY-MM — the renewal_jobs.billing_period of a monthly row
  period: ServicePeriod;
}

export function currentBillingCycle(now: Date = new Date()): BillingCycle {
  const key = billingMonthKey(now);
  return { key, period: servicePeriod(key) };
}

// HubSpot returns date properties in two shapes: plain "YYYY-MM-DD" for
// date fields and an epoch-ms string (UTC midnight) for calculated ones
// such as billing_term_end_date. Both are calendar dates, so neither is
// shifted into IST here.
export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (/^\d+$/.test(value)) {
    return new Date(Number(value)).toISOString().slice(0, 10);
  }
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1]! : null;
}

// Razorpay timestamps are epoch seconds.
export function unixSecondsToIstDate(seconds: number): string {
  return istToday(new Date(seconds * 1000));
}
