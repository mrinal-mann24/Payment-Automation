import { z } from "zod";
import { istToday } from "./billingCycle.js";

// HubSpot object ids are digits only. A request value is placed in HubSpot
// URL paths, so anything else (slashes, dots, query characters) is refused
// before it gets there.
export const hubspotIdSchema = z.string().regex(/^\d+$/, "must be a numeric HubSpot id");

// A real calendar date (YYYY-MM-DD) no later than `today`. The round trip
// through Date rejects impossible dates such as 2026-02-30.
export function isRealDateNotAfter(value: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value <= today;
}

// The payment date becomes HubSpot's Date Paid and the Zoho payment date.
export const paymentDateSchema = z
  .string()
  .refine((value) => isRealDateNotAfter(value, istToday()), "must be a real date, not in the future");

export const MAX_AMOUNT = 10_000_000; // one crore rupees

export const amountSchema = z.number().positive().max(MAX_AMOUNT);
