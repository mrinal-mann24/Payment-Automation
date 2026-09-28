import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findAdminCycleJobs } from "../repositories/renewalJobs.js";

// Captures the PostgREST filter the query is built with.
function capturingSupabase(captured: { or?: string }): SupabaseClient {
  const chain = {
    select: () => chain,
    or: (filter: string) => {
      captured.or = filter;
      return chain;
    },
    order: async () => ({ data: [], error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

describe("findAdminCycleJobs", () => {
  it("keeps a paid cycle with an unfinished settlement step on the admin page, whatever month it started in", async () => {
    const captured: { or?: string } = {};

    await findAdminCycleJobs(capturingSupabase(captured), "2026-10");

    expect(captured.or).toContain("paid_at.is.null");
    expect(captured.or).toContain("service_period_start.gte.2026-10-01");
    expect(captured.or).toContain(
      "and(paid_at.not.is.null,or(invoice_step_status.neq.done,zoho_payment_id.is.null,periskope_payment_confirmed_sent.is.false,invoice_email_sent.is.false,hubspot_renewal_done.is.false))",
    );
  });
});
