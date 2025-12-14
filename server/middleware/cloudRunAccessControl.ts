import type { NextFunction, Request, Response } from "express";
import { verifyGoogleOidcToken } from "../_core/auth/googleOidc";

const GOOGLE_ISSUER = "https://accounts.google.com";

function parseBearerToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  return match?.[1]?.trim() ? match[1].trim() : null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseCsvEnv(name: string): string[] {
  const raw = process.env[name] ?? "";
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

export type CloudRunAccessDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 500; code: string; message: string };

export function decideCloudRunAccess(input: {
  workspaceDomain: string;
  allowedServiceAccounts: string[];
  tokenPayload: { iss?: unknown; email?: unknown };
}): CloudRunAccessDecision {
  const domain = input.workspaceDomain.trim().toLowerCase();
  const allowedServiceAccounts = input.allowedServiceAccounts.map(normalizeEmail);

  if (!domain && allowedServiceAccounts.length === 0) {
    return {
      ok: false,
      status: 500,
      code: "access_control_misconfigured",
      message:
        "Access control misconfigured: WORKSPACE_DOMAIN or INTERNAL_SERVICE_ACCOUNT_EMAILS must be set",
    };
  }

  if (input.tokenPayload.iss !== GOOGLE_ISSUER) {
    return {
      ok: false,
      status: 401,
      code: "invalid_issuer",
      message: "Token issuer is not accepted",
    };
  }

  if (typeof input.tokenPayload.email !== "string" || !input.tokenPayload.email.trim()) {
    return {
      ok: false,
      status: 403,
      code: "missing_email_claim",
      message: "Token is missing required email claim",
    };
  }

  const email = normalizeEmail(input.tokenPayload.email);

  if (domain && email.endsWith(`@${domain}`)) {
    return { ok: true };
  }

  if (allowedServiceAccounts.includes(email)) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 403,
    code: "forbidden",
    message: "Caller is not authorized for this service",
  };
}

function sendAuthError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({
    source: "error",
    error: {
      code,
      message,
    },
  });
}

/**
 * Enforces that all `/api/*` requests come from:
 * - an authenticated Google Workspace user in WORKSPACE_DOMAIN, OR
 * - an authorized internal service account in INTERNAL_SERVICE_ACCOUNT_EMAILS
 *
 * Tokens are expected as: Authorization: Bearer <OIDC ID token>
 */
export async function requireCloudRunApiAccess(req: Request, res: Response, next: NextFunction) {
  // Only protect API endpoints (do not block static assets / client routing).
  if (!req.path.startsWith("/api/")) return next();

  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    return sendAuthError(res, 401, "missing_token", "Missing Authorization bearer token");
  }

  let payload: { iss?: unknown; email?: unknown };
  try {
    payload = await verifyGoogleOidcToken(token);
  } catch {
    return sendAuthError(res, 401, "invalid_token", "Invalid or expired token");
  }

  const decision = decideCloudRunAccess({
    workspaceDomain: process.env.WORKSPACE_DOMAIN ?? "",
    allowedServiceAccounts: parseCsvEnv("INTERNAL_SERVICE_ACCOUNT_EMAILS"),
    tokenPayload: payload,
  });

  if (!decision.ok) {
    return sendAuthError(res, decision.status, decision.code, decision.message);
  }

  return next();
}

