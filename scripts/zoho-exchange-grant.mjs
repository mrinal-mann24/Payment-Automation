// Run this yourself: node scripts/zoho-exchange-grant.mjs <fresh_grant_code> <redirect_uri>
// Reads ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET from .env, prints the refresh_token
// so you can paste it into .env yourself. Delete this file's output from your
// terminal scrollback once you've copied it.

import "dotenv/config";

const [, , grantCode, redirectUri] = process.argv;

if (!grantCode || !redirectUri) {
  console.error("Usage: node scripts/zoho-exchange-grant.mjs <fresh_grant_code> <redirect_uri>");
  process.exit(1);
}

const params = new URLSearchParams({
  code: grantCode,
  client_id: process.env.ZOHO_CLIENT_ID,
  client_secret: process.env.ZOHO_CLIENT_SECRET,
  redirect_uri: redirectUri,
  grant_type: "authorization_code",
});

const res = await fetch(`https://accounts.zoho.in/oauth/v2/token?${params.toString()}`, {
  method: "POST",
});
const body = await res.json();

if (body.refresh_token) {
  console.log("\nSuccess. Copy this into .env as ZOHO_REFRESH_TOKEN:\n");
  console.log(body.refresh_token);
  console.log("\nScopes granted:", body.scope ?? "(not returned)");
} else {
  console.log("\nFailed:", JSON.stringify(body, null, 2));
}
