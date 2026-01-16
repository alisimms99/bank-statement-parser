import type { Request, Response, NextFunction } from "express";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { jwtVerify, SignJWT } from "jose";
import { ENV } from "../_core/env";

export interface AuthenticatedUser {
  id: number;
  openId: string;
  name?: string;
  email?: string;
  role?: string;
  accessToken?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

const SECRET_KEY = new TextEncoder().encode(ENV.cookieSecret || "dev-secret-key");

export async function verifySessionToken(token: string): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, SECRET_KEY);
    return {
      id: payload.id as number,
      openId: payload.openId as string,
      name: payload.name as string | undefined,
      email: payload.email as string | undefined,
      role: payload.role as string | undefined,
      accessToken: payload.accessToken as string | undefined,
    };
  } catch (error) {
    console.warn("[Auth] Token verification failed:", error);
    return null;
  }
}

export async function createSessionToken(user: AuthenticatedUser): Promise<string> {
  const token = await new SignJWT({
    id: user.id,
    openId: user.openId,
    name: user.name,
    email: user.email,
    role: user.role,
    accessToken: user.accessToken,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET_KEY);

  return token;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const cookieHeader = req.headers.cookie || "";
  const cookies = parseCookie(cookieHeader);
  const token = cookies[COOKIE_NAME];

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = await verifySessionToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  req.user = user;
  next();
}

export function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const cookieHeader = req.headers.cookie || "";
  const cookies = parseCookie(cookieHeader);
  const token = cookies[COOKIE_NAME];

  if (token) {
    verifySessionToken(token).then((user) => {
      if (user) req.user = user;
      next();
    }).catch(() => {
      next();
    });
  } else {
    next();
  }
}
