import "dotenv/config";
import { createEstimate, findOrCreateCustomer } from "../src/clients/zoho.js";
import type { HubspotDeal } from "../src/clients/hubspot.js";

async function main() {
  const testEmail = process.argv[2];
  if (!testEmail) {
    console.error("Usage: tsx scripts/test-zoho-estimate.ts <test-email>");
    process.exit(1);
  }

  console.log(`Finding or creating Zoho customer for ${testEmail}...`);
  const customerId = await findOrCreateCustomer(testEmail, "Test Customer");
  console.log(`Zoho customer_id: ${customerId}`);

  const fakeDeal: HubspotDeal = {
    dealId: "test-deal-manual",
    dealName: "Manual test renewal",
    billingPeriod: "2026-07",
    contactEmail: testEmail,
    contactName: "Test Customer",
    lineItems: [{ id: "test-line-1", name: "Test renewal line item", quantity: 1, price: 100 }],
  };

  console.log("Creating Zoho estimate...");
  const { estimateId, estimateNumber } = await createEstimate(customerId, fakeDeal);
  console.log(`Created estimate: ${estimateNumber} (id: ${estimateId})`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
