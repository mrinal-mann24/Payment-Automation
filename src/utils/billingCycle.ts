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
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error(`Billing month key must be YYYY-MM, got "${monthKey}"`);
  }
  return servicePeriodFrom(`${monthKey}-01`, 1);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTH_NAMES[month! - 1]} ${year}`;
}

// A service period of `months` months starting on `start` (YYYY-MM-DD):
// it ends the day before the same day-of-month `months` later, clamped to
// the last day of a shorter month. Started on the 1st for one month it is
// exactly the calendar month.
export function servicePeriodFrom(start: string, months: number): ServicePeriod {
  const [year, month, day] = start.split("-").map(Number);
  const lastDayOfTarget = new Date(Date.UTC(year!, month! - 1 + months + 1, 0)).getUTCDate();
  const endExclusive = Date.UTC(year!, month! - 1 + months, Math.min(day!, lastDayOfTarget));
  const end = isoDate(new Date(endExclusive - 86_400_000));
  return { start, end, narration: `Service period: ${longDate(start)} to ${longDate(end)}` };
}

export interface BillingCycle {
  key: string; // renewal_jobs.billing_period: YYYY-MM for a monthly cycle, the start date for a term cycle
  period: ServicePeriod;
  months: number; // 1 = calendar month, 3 = quarterly, 6 = half-yearly
  amount: number | null; // pre-tax amount to bill; null = the deal's client_pricing base price (monthly)
}

export function currentBillingCycle(now: Date = new Date()): BillingCycle {
  const key = billingMonthKey(now);
  return { key, period: servicePeriod(key), months: 1, amount: null };
}

// A quarterly / half-yearly cycle starts the day the client's last term
// ended (HubSpot's billing end date is exclusive) and bills what they paid
// last time.
export function termBillingCycle(periodStart: string, months: number, amount: number): BillingCycle {
  return { key: periodStart, period: servicePeriodFrom(periodStart, months), months, amount };
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
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
