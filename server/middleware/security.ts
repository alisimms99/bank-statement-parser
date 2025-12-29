import type { NextFunction, Request, Response } from "express";
import { requireCloudRunApiAccess } from "./cloudRunAccessControl";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const PDF_SIGNATURE = "%PDF-";
const DEFAULT_ALLOWLIST = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function parseAllowlist(): string[] {
  const raw = process.env.CORS_ALLOWLIST ?? process.env.ALLOWED_ORIGINS ?? "";
  const origins = raw
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : DEFAULT_ALLOWLIST;
}

function buildCspDirectives() {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' http://localhost:5173 ws://localhost:5173 http://127.0.0.1:5173",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "frame-ancestors 'self'",
    ].join("; ");
  }

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https://lh3.googleusercontent.com",
    "connect-src 'self' https://us-documentai.googleapis.com https://*.googleapis.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

const allowlist = parseAllowlist();
const csp = buildCspDirectives();

function sendUploadError(res: Response, status: number, code: string, message: string, details?: string) {
  res.status(status).json({
    source: "error",
    error: {
      code,
      message,
      details,
    },
  });
}

export function applySecurityHeaders(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin && allowlist.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", csp);

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  // Apply Cloud Run access control to all API endpoints.
  return requireCloudRunApiAccess(req, res, next);
}

export function uploadValidationMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path !== "/api/ingest" || req.method !== "POST") {
    return next();
  }

  // Support both multipart (file) and JSON (contentBase64) formats
  let buffer: Buffer | null = null;
  let fileName: string | undefined;

  // Check for multipart file upload first
  if (req.file) {
    buffer = req.file.buffer;
    fileName = req.file.originalname;
  } else {
    // Check for JSON body with contentBase64
    const { contentBase64 } = req.body ?? {};
    
    if (typeof contentBase64 !== "string" || contentBase64.trim().length === 0) {
      // If no file and no contentBase64, let the route handler deal with it
      // (it will return a proper error message)
      return next();
    }

    try {
      buffer = Buffer.from(contentBase64, "base64");
    } catch (error) {
      return sendUploadError(res, 400, "invalid_base64", "Upload payload is not valid Base64");
    }

    fileName = req.body?.fileName;
  }

  // If we have a buffer, validate it
  if (buffer) {
    if (buffer.length === 0) {
      return sendUploadError(res, 400, "empty_payload", "Upload payload cannot be empty");
    }

    if (buffer.length > MAX_UPLOAD_BYTES) {
      return sendUploadError(
        res,
        413,
        "payload_too_large",
        "File exceeds the 25MB upload limit",
        `limit=${MAX_UPLOAD_BYTES}, received=${buffer.length}`
      );
    }

    const signature = buffer.slice(0, PDF_SIGNATURE.length).toString("utf8");
    if (!signature.startsWith(PDF_SIGNATURE)) {
      return sendUploadError(
        res,
        415,
        "invalid_file_type",
        "Only PDF uploads are accepted",
        `file=${fileName ?? "unnamed"}, signature=${signature || "<empty>"}`
      );
    }
  }

  return next();
}

