export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  gcpProjectId: process.env.GCP_PROJECT_ID ?? "",
  gcpLocation: process.env.GCP_LOCATION ?? "us", // Document AI default location
  gcpBankProcessorId: process.env.GCP_BANK_PROCESSOR_ID ?? "",
  gcpInvoiceProcessorId: process.env.GCP_INVOICE_PROCESSOR_ID ?? "",
  gcpOcrProcessorId: process.env.GCP_OCR_PROCESSOR_ID ?? "",
  gcpCredentialsJson: process.env.GCP_DOCUMENTAI_CREDENTIALS ?? "",
};
