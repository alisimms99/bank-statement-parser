import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const GOOGLE_ISSUER = "https://accounts.google.com";
const DEFAULT_GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

type GoogleOidcClaims = JWTPayload & {
  email?: string;
  email_verified?: boolean;
};

let cachedJwks:
  | ReturnType<typeof createRemoteJWKSet>
  | null = null;
let cachedJwksUrl: string | null = null;

function getGoogleJwksUrl(): string {
  // Test override / advanced deployments. In production, the default is correct.
  return (process.env.GOOGLE_OIDC_JWKS_URL ?? DEFAULT_GOOGLE_JWKS_URL).trim();
}

function getJwks() {
  const url = getGoogleJwksUrl();
  if (!cachedJwks || cachedJwksUrl !== url) {
    cachedJwks = createRemoteJWKSet(new URL(url));
    cachedJwksUrl = url;
  }
  return cachedJwks;
}

export interface VerifyGoogleOidcTokenOptions {
  /**
   * Optional audience check. If set, jwtVerify will require the token's `aud`
   * to match. If unset, we only validate signature + issuer + standard claims.
   */
  audience?: string;
}

/**
 * Verifies a Google-signed OIDC ID token (including Cloud Run invocation tokens).
 *
 * Enforces:
 * - signature via Google's JWKS
 * - issuer = https://accounts.google.com
 *
 * Authorization decisions (domain/service-account allowlist) are handled by middleware.
 */
export async function verifyGoogleOidcToken(
  token: string,
  options: VerifyGoogleOidcTokenOptions = {}
): Promise<GoogleOidcClaims> {
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: GOOGLE_ISSUER,
    audience: options.audience,
  });

  return payload as GoogleOidcClaims;
}

