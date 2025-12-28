import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { verifySessionToken, type SessionUser } from "../middleware/auth";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import * as db from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | SessionUser | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | SessionUser | null = null;

  try {
    // Extract session token from cookies
    const cookieHeader = opts.req.headers.cookie;
    if (cookieHeader) {
      const cookies = parseCookieHeader(cookieHeader);
      const sessionToken = cookies[COOKIE_NAME];

      if (sessionToken) {
        const session = await verifySessionToken(sessionToken);
        if (session) {
          // Try to get user from database (optional - database may not be configured)
          try {
            const dbUser = await db.getUserByOpenId(session.openId);
            user = dbUser ?? null;
          } catch (dbError) {
            // Database unavailable - use session data as fallback
            console.warn("[Context] Database unavailable, using session data:", dbError);
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
        }
      }
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
