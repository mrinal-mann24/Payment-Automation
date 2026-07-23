function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  get port() {
    return Number(process.env.PORT ?? 3000);
  },
  zoho: {
    get clientId() {
      return requireEnv("ZOHO_CLIENT_ID");
    },
    get clientSecret() {
      return requireEnv("ZOHO_CLIENT_SECRET");
    },
    get refreshToken() {
      return requireEnv("ZOHO_REFRESH_TOKEN");
    },
    get orgId() {
      return requireEnv("ZOHO_ORG_ID");
    },
  },
  hubspot: {
    get privateAppToken() {
      return requireEnv("HUBSPOT_PRIVATE_APP_TOKEN");
    },
  },
  razorpay: {
    get keyId() {
      return requireEnv("RAZORPAY_KEY_ID");
    },
    get keySecret() {
      return requireEnv("RAZORPAY_KEY_SECRET");
    },
    get webhookSecret() {
      return requireEnv("RAZORPAY_WEBHOOK_SECRET");
    },
  },
  periskope: {
    get bearerToken() {
      return requireEnv("PERISKOPE_BEARER_TOKEN");
    },
    get xPhone() {
      return requireEnv("PERISKOPE_X_PHONE");
    },
  },
  supabase: {
    get url() {
      return requireEnv("SUPABASE_URL");
    },
    get serviceRoleKey() {
      return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    },
  },
  neon: {
    get databaseUrl() {
      return requireEnv("NEON_DATABASE_URL");
    },
  },
};
