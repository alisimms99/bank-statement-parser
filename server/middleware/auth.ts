import type { Request, Response, NextFunction } from "express";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "../_core/env";
import * as db from "../db";
import type { User } from "../../drizzle/schema";

// Minimal user type for when database is unavailable
export interface SessionUser {
  email: string;
  name?: string | null;
  openId: string;
  loginMethod?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: User | SessionUser;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

function getSessionSecret() {
  const secret = ENV.cookieSecret;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

interface SessionPayload {
  email: string;
  name?: string;
  picture?: string;
  openId: string; // Use email as openId for Google OAuth
  accessToken?: string;
  refreshToken?: string;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const secretKey = getSessionSecret();
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });

    const { email, name, picture, openId, accessToken, refreshToken } = payload as Record<
      string,
      unknown
    >;

    if (!isNonEmptyString(email) || !isNonEmptyString(openId)) {
      console.warn("[Auth] Session payload missing required fields");
      return null;
    }

    return {
      email,
      name: typeof name === "string" ? name : undefined,
      picture: typeof picture === "string" ? picture : undefined,
      openId,
      accessToken: isNonEmptyString(accessToken) ? accessToken : undefined,
      refreshToken: isNonEmptyString(refreshToken) ? refreshToken : undefined,
    };
  } catch (error) {
    console.warn("[Auth] Session verification failed", String(error));
    return null;
  }
}

async function getSessionFromRequest(req: Request): Promise<SessionPayload | null> {
  // 1. Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const session = await verifySessionToken(token);
    if (session) return session;
  }

  // 2. Fallback to cookie
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const cookies = parseCookieHeader(cookieHeader);
  const sessionToken = cookies[COOKIE_NAME];

  if (!sessionToken) {
    return null;
  }

  return verifySessionToken(sessionToken);
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await getSessionFromRequest(req);

    if (!session) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Try to get user from database (optional - database may not be configured)
    let user: User | SessionUser | null = null;
    
    try {
      const dbUser = await db.getUserByOpenId(session.openId);
      user = dbUser ?? null;

      if (!user) {
        // Try to create user if doesn't exist (database may not be available)
        try {
          await db.upsertUser({
            openId: session.openId,
            email: session.email,
            name: session.name ?? null,
            loginMethod: "google",
            lastSignedIn: new Date(),
          });
          const createdUser = await db.getUserByOpenId(session.openId);
          user = createdUser ?? null;
        } catch (dbError) {
          // Database unavailable - use session data as fallback
          console.warn("[Auth] Database unavailable, using session data:", dbError);
        }
      } else {
        // Update last signed in (if database is available)
        try {
          await db.upsertUser({
            openId: user.openId,
            lastSignedIn: new Date(),
          });
        } catch (dbError) {
          // Database unavailable - continue with existing user data
          console.warn("[Auth] Failed to update lastSignedIn:", dbError);
        }
      }
    } catch (dbError) {
      // Database unavailable - use session data as fallback
      console.warn("[Auth] Database unavailable, using session data:", dbError);
    }

    // If database user not available, use session data (OAuth-verified email is sufficient)
    if (!user) {
      user = {
        email: session.email,
        name: session.name ?? null,
        openId: session.openId,
        loginMethod: "google",
      } satisfies SessionUser;
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("[Auth] Authentication error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
}

export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await getSessionFromRequest(req);

    if (session) {
      let user: User | SessionUser | null = null;

      // Try to get user from database (optional - database may not be configured)
      try {
        const dbUser = await db.getUserByOpenId(session.openId);
        user = dbUser ?? null;

        if (!user) {
          // Try to create user if doesn't exist (database may not be available)
          try {
            await db.upsertUser({
              openId: session.openId,
              email: session.email,
              name: session.name ?? null,
              loginMethod: "google",
              lastSignedIn: new Date(),
            });
            const createdUser = await db.getUserByOpenId(session.openId);
            user = createdUser ?? null;
          } catch (dbError) {
            // Database unavailable - use session data as fallback
            console.warn("[Auth] Database unavailable, using session data:", dbError);
          }
        }
      } catch (dbError) {
        // Database unavailable - use session data as fallback
        console.warn("[Auth] Database unavailable, using session data:", dbError);
      }

      // If database user not available, use session data (OAuth-verified email is sufficient)
      if (!user) {
        user = {
          email: session.email,
          name: session.name ?? null,
          openId: session.openId,
          loginMethod: "google",
        } satisfies SessionUser;
      }

      if (user) {
        req.user = user;
      }
    }

    next();
  } catch (error) {
    // Don't block request on optional auth errors
    console.warn("[Auth] Optional auth error:", error);
    next();
  }
}

export async function createSessionToken(payload: SessionPayload & { accessToken?: string; refreshToken?: string }): Promise<string> {
  const secretKey = getSessionSecret();
  const issuedAt = Date.now();
  const expiresInMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);

  const claims: Record<string, string> = {
    email: payload.email,
    name: payload.name ?? "",
    picture: payload.picture ?? "",
    openId: payload.openId,
  };

  // Optional OAuth tokens (used e.g. for Google Sheets export)
  if (isNonEmptyString(payload.accessToken)) {
    claims.accessToken = payload.accessToken;
  }
  if (isNonEmptyString(payload.refreshToken)) {
    claims.refreshToken = payload.refreshToken;
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .setIssuedAt(Math.floor(issuedAt / 1000))
    .sign(secretKey);
}

