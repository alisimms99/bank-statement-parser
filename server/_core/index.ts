import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./vite";
import { registerIngestionRoutes } from "../ingestRoutes";
import { registerExportRoutes } from "../exportRoutes";
import { applySecurityHeaders, uploadValidationMiddleware } from "../middleware/security";
import { assertEnvOnStartup, getServerEnv } from "./env";
import { logEvent } from "./log";

function applyCors(app: express.Express, corsAllowOrigin: string | null): void {
  if (!corsAllowOrigin) return;

  const allowed = corsAllowOrigin
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const allowAny = allowed.includes("*");
  const allowCredentials = !allowAny; // "*" cannot be combined with credentials

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const requestedHeaders = req.headers["access-control-request-headers"];
    const requestedMethod = req.headers["access-control-request-method"];

    if (allowAny) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (typeof origin === "string" && allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    if (allowCredentials) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    if (requestedHeaders) {
      res.setHeader("Access-Control-Allow-Headers", String(requestedHeaders));
    } else {
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }

    if (requestedMethod) {
      res.setHeader("Access-Control-Allow-Methods", String(requestedMethod));
    } else {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    }

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    next();
  });
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // Fail fast on production misconfigurations.
  assertEnvOnStartup();
  const serverEnv = getServerEnv();

  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(applySecurityHeaders);
  app.use(uploadValidationMiddleware);

  applyCors(app, serverEnv.corsAllowOrigin);

  // Health check endpoint for Cloud Run / orchestrators
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: new Date() });
  });

  registerIngestionRoutes(app);
  registerExportRoutes(app);
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = serverEnv.port;
  const port =
    process.env.NODE_ENV === "production" ? preferredPort : await findAvailablePort(preferredPort);

  if (process.env.NODE_ENV !== "production" && port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    logEvent("server_listen", { port, env: process.env.NODE_ENV ?? "unknown" });
  });
}

startServer().catch(console.error);
