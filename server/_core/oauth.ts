import { COOKIE_NAME } from "@shared/const";
import type { Express, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { getSessionCookieOptions } from "./cookies";
import { createSessionToken } from "../middleware/auth";
import { ENV } from "./env";

const ALLOWED_DOMAIN = "oddjobspropertymaintenance.com";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getGoogleOAuthClient(): OAuth2Client | null {
  const clientId = ENV.googleClientId;
  const clientSecret = ENV.googleClientSecret;
  const redirectUri = ENV.oauthCallbackUrl;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[OAuth] Google OAuth not configured. Missing:", {
      clientId: !clientId,
      clientSecret: !clientSecret,
      redirectUri: !redirectUri,
    });
    return null;
  }

  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

export function registerOAuthRoutes(app: Express) {
  // GET /api/auth/google - Redirect to Google OAuth
  app.get("/api/auth/google", (req: Request, res: Response) => {
    const client = getGoogleOAuthClient();
    if (!client) {
      res.status(500).json({ error: "OAuth not configured" });
      return;
    }

    // Generate state for CSRF protection
    const state = Buffer.from(JSON.stringify({ redirect: req.query.redirect || "/" })).toString("base64");

    const scopes = [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ];
    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      scope: scopes.join(" "),
      state,
      prompt: "select_account",
    });

    res.redirect(authUrl);
  });

  // GET /api/auth/google/callback - Handle OAuth callback
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code) {
      res.status(400).json({ error: "Authorization code is required" });
      return;
    }

    const client = getGoogleOAuthClient();
    if (!client) {
      res.status(500).json({ error: "OAuth not configured" });
      return;
    }

    try {
      // Exchange code for tokens
      const { tokens } = await client.getToken(code).catch(error => {
        console.error("[OAuth] Token exchange failed:", {
          error: error instanceof Error ? error.message : String(error),
          code: error instanceof Error && 'code' in error ? error.code : undefined,
          redirectUri: ENV.oauthCallbackUrl,
          hasCode: !!code,
        });
        throw error;
      });
      client.setCredentials(tokens);

      if (!tokens.id_token) {
        res.status(400).json({ error: "ID token missing from OAuth response" });
        return;
      }

      // Verify and decode ID token
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: ENV.googleClientId!,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        res.status(400).json({ error: "Invalid ID token payload" });
        return;
      }

      const email = payload.email;
      const emailVerified = payload.email_verified;
      const name = payload.name;
      const picture = payload.picture;
      const hd = payload.hd; // Hosted domain (for workspace accounts)

      if (!email || !emailVerified) {
        res.status(400).json({ error: "Email verification required" });
        return;
      }

      // Domain restriction (only in production)
      if (ENV.isProduction && hd !== ALLOWED_DOMAIN) {
        res.status(403).json({
          error: `Access restricted to @${ALLOWED_DOMAIN} accounts`,
        });
        return;
      }

      // Try to create user in database (optional - database may not be configured)
      try {
        const db = await import("../db");
        await db.upsertUser({
          openId: email,
          email,
          name: name ?? null,
          loginMethod: "google",
          lastSignedIn: new Date(),
        });
      } catch (dbError) {
        // Database unavailable - continue without database user (session is sufficient)
        console.warn("[OAuth] Database unavailable, continuing without DB user:", dbError);
      }

      // Create session token
      const sessionToken = await createSessionToken({
        email,
        name: name ?? undefined,
        picture: picture ?? undefined,
        openId: email, // Use email as openId
        accessToken: tokens.access_token ?? undefined,
        refreshToken: tokens.refresh_token ?? undefined,
      });

      // Set session cookie
      const cookieOptions = getSessionCookieOptions(req);
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      
      console.log("[OAuth] Setting session cookie:", {
        cookieName: COOKIE_NAME,
        hasToken: !!sessionToken,
        tokenLength: sessionToken.length,
        cookieOptions,
        maxAge,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
        httpOnly: cookieOptions.httpOnly,
        path: cookieOptions.path,
      });
      
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge });

      // Parse redirect from state
      let redirect = "/";
      if (state) {
        try {
          const decoded = JSON.parse(Buffer.from(state, "base64").toString());
          if (decoded.redirect && typeof decoded.redirect === "string") {
            // Validate redirect to prevent open redirect vulnerability
            const requestedRedirect = decoded.redirect;
            
            // Only allow relative paths (starting with / but not //) or same-origin URLs
            // Protocol-relative URLs like //evil.com are rejected
            if (requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//")) {
              // Relative path - safe to use
              redirect = requestedRedirect;
            } else {
              // Absolute URL - verify it's same-origin
              try {
                const redirectUrl = new URL(requestedRedirect);
                
                // Determine current origin from the callback URL
                if (!ENV.oauthCallbackUrl) {
                  console.error("[OAuth] Cannot validate redirect: oauthCallbackUrl not configured");
                  // Use default redirect for security
                } else {
                  const currentOrigin = new URL(ENV.oauthCallbackUrl).origin;
                  
                  if (redirectUrl.origin === currentOrigin) {
                    redirect = requestedRedirect;
                  } else {
                    console.warn("[OAuth] Rejected external redirect:", requestedRedirect);
                    // Use default redirect for security
                  }
                }
              } catch {
                console.warn("[OAuth] Invalid redirect URL:", requestedRedirect);
                // Use default redirect for invalid URLs
              }
            }
          }
        } catch {
          // Invalid state, use default redirect
        }
      }

      console.log("[OAuth] Callback successful, redirecting to:", redirect);
      res.redirect(302, redirect);
    } catch (error) {
      console.error("[OAuth] Callback failed:", {
        error: error instanceof Error ? error.message : String(error),
        code: error instanceof Error && 'code' in error ? error.code : undefined,
        redirectUri: ENV.oauthCallbackUrl,
        clientId: ENV.googleClientId ? `${ENV.googleClientId.substring(0, 10)}...` : 'missing',
      });
      
      // Provide more helpful error messages
      const errorMessage = error instanceof Error ? error.message : String(error);
      let userMessage = "OAuth callback failed";
      if (errorMessage.includes("invalid_grant")) {
        userMessage = "OAuth callback failed: invalid_grant. This usually means the redirect URI doesn't match Google OAuth settings, or the authorization code expired/was already used.";
      }
      
      res.status(500).json({
        error: userMessage,
        details: errorMessage,
      });
    }
  });

  // POST /api/auth/logout - Clear session
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    res.json({ success: true });
  });

  // GET /api/auth/me - Return current user info
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const { verifySessionToken } = await import("../middleware/auth");
      const { parse: parseCookie } = await import("cookie");
      
      const cookieHeader = req.headers.cookie;
      console.log("[OAuth] /api/auth/me called:", {
        hasCookieHeader: !!cookieHeader,
        cookieHeaderLength: cookieHeader?.length ?? 0,
        cookieName: COOKIE_NAME,
      });

      if (!cookieHeader) {
        console.log("[OAuth] No cookie header found");
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const cookies = parseCookie(cookieHeader);
      const sessionToken = cookies[COOKIE_NAME];

      console.log("[OAuth] Parsed cookies:", {
        cookieNames: Object.keys(cookies),
        hasSessionToken: !!sessionToken,
        sessionTokenLength: sessionToken?.length ?? 0,
      });

      if (!sessionToken) {
        console.log("[OAuth] Session token not found in cookies");
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const session = await verifySessionToken(sessionToken);
      if (!session) {
        console.log("[OAuth] Session token verification failed");
        res.status(401).json({ error: "Invalid session" });
        return;
      }

      console.log("[OAuth] Session verified successfully:", {
        email: session.email,
        hasName: !!session.name,
      });

      res.json({
        email: session.email,
        name: session.name,
        picture: session.picture,
      });
    } catch (error) {
      console.error("[OAuth] Get user info failed:", error);
      res.status(500).json({ error: "Failed to get user info" });
    }
  });

  // GET /api/auth/token - Return access token for Google APIs
  app.get("/api/auth/token", async (req: Request, res: Response) => {
    try {
      const { verifySessionToken } = await import("../middleware/auth");
      const { parse: parseCookie } = await import("cookie");
      
      const cookieHeader = req.headers.cookie;
      if (!cookieHeader) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const cookies = parseCookie(cookieHeader);
      const sessionToken = cookies[COOKIE_NAME];

      if (!sessionToken) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const session = await verifySessionToken(sessionToken);
      if (!session) {
        res.status(401).json({ error: "Invalid session" });
        return;
      }

      if (!session.accessToken) {
        res.status(401).json({ error: "No access token available. Please sign in again." });
        return;
      }

      res.json({
        accessToken: session.accessToken,
      });
    } catch (error) {
      console.error("[OAuth] Get access token failed:", error);
      res.status(500).json({ error: "Failed to get access token" });
    }
  });
}
