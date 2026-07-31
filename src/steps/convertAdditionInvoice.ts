import type { SupabaseClient } from "@supabase/supabase-js";
import { convertEstimateToInvoice } from "../clients/zoho.js";
import {
  findAdditionChargeByEstimateNumber,
  markAdditionInvoiceStepDone,
  markAdditionInvoiceStepFailed,
} from "../repositories/additionCharges.js";

export interface ConvertAdditionInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
}

export async function convertAdditionInvoice(
  supabase: SupabaseClient,
  estimateNumber: string,
): Promise<ConvertAdditionInvoiceResult> {
  const charge = await findAdditionChargeByEstimateNumber(supabase, estimateNumber);

  if (!charge || charge.status !== "done") {
    throw new Error(
      `Cannot run invoice step for addition charge estimate ${estimateNumber}: charge status is not "done"`,
    );
  }

  if (charge.invoice_step_status === "done" && charge.zoho_invoice_id && charge.zoho_invoice_number) {
    return { invoiceId: charge.zoho_invoice_id, invoiceNumber: charge.zoho_invoice_number };
  }

  if (!charge.zoho_estimate_id) {
    throw new Error(`addition_charges row for estimate ${estimateNumber} is missing zoho_estimate_id`);
  }

  try {
    const { invoiceId, invoiceNumber } = await convertEstimateToInvoice(charge.zoho_estimate_id);
    await markAdditionInvoiceStepDone(supabase, charge.id, invoiceId, invoiceNumber);
    return { invoiceId, invoiceNumber };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markAdditionInvoiceStepFailed(supabase, charge.id, message);
    throw err;
  }
}
