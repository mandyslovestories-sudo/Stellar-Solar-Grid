import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import timeout from "connect-timeout";
import rateLimit from "express-rate-limit";
import mqtt from "mqtt";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import { createRequire } from "module";

import { stellarService, server } from "./lib/stellar.js";
import { register, httpRequestDuration } from "./lib/metrics.js";
import { logger } from "./lib/logger.js";
import { initUsageEventStore, startUsageEventRetryWorker } from "./lib/usageEvents.js";

import { createMeterRouter } from "./routes/meters.js";
import { paymentsRouter } from "./routes/payments.js";
import { webhookRouter } from "./routes/webhooks.js";
import { collaboratorRouter } from "./routes/collaborators.js";
import { allowlistRouter } from "./routes/allowlist.js";
import { statsRouter } from "./routes/stats.js";
import { metricsRouter } from "./routes/metrics.js";

import { writeLimiter, readLimiter } from "./middleware/rateLimit.js";
import { requireAdminKey } from "./middleware/adminAuth.js";
import requestLoggerMiddleware from "./middleware/requestLogger.js";
import { sanitiseBody } from "./middleware/sanitise.js";

import { startIoTBridge } from "./iot/bridge.js";
import { startLimitWatcher } from "./iot/limitWatcher.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../../package.json") as { version: string };

// ── Env validation ─────────────────────────────────────────────────────────

const REQUIRED_ENV = ["CONTRACT_ID", "ADMIN_SECRET_KEY", "STELLAR_RPC_URL", "MQTT_BROKER"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  logger.fatal({ missing }, "Missing required environment variables. Copy backend/.env.example to backend/.env.");
  process.exit(1);
}

const PORT = process.env.PORT ?? 3001;
const BODY_LIMIT = process.env.REQUEST_BODY_LIMIT ?? "100kb";
const requestTimeout = process.env.REQUEST_TIMEOUT ?? "15s";

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 60);
const PAYMENTS_RATE_LIMIT_MAX = Number(process.env.PAYMENTS_RATE_LIMIT_MAX ?? 10);
const RATE_LIMIT_MESSAGE = process.env.RATE_LIMIT_MESSAGE ?? "Too many requests, please try again later.";

const app = express();
const startTime = Date.now();

// ── Security headers ───────────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
  }),
);

// ── CORS ───────────────────────────────────────────────────────────────────

const allowedOrigins = (process.env.CORS_ORIGIN ?? "*").split(",").map((o) => o.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Key"],
    optionsSuccessStatus: 204,
  }),
);

// ── Prometheus scrape endpoint ─────────────────────────────────────────────
// Must be registered BEFORE rate limiters and auth middleware so scrapers
// (Prometheus, Grafana Agent) are never blocked or challenged.

app.get("/metrics", async (_req: Request, res: Response) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// ── HTTP duration instrumentation ──────────────────────────────────────────
// Attach a timer on every request; record it when the response finishes.
// Also placed before rate limiters so we capture 429s in the histogram too.

app.use((req: Request, res: Response, next: NextFunction) => {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    end({
      method: req.method,
      route: req.route?.path ?? req.path,
      status: String(res.statusCode),
    });
  });
  next();
});

// ── Rate limiting ──────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.setHeader("Retry-After", String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    res.status(429).json({ error: RATE_LIMIT_MESSAGE });
  },
});

const paymentsLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: PAYMENTS_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.setHeader("Retry-After", String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    res.status(429).json({ error: RATE_LIMIT_MESSAGE });
  },
});

app.use(readLimiter);
app.use("/api", globalLimiter);

// ── Body parsing ───────────────────────────────────────────────────────────

app.use(
  express.json({
    limit: BODY_LIMIT,
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// ── Misc middleware ────────────────────────────────────────────────────────

app.use(sanitiseBody);
app.use(requestLoggerMiddleware);
app.use(timeout(requestTimeout));
app.use((req: any, _res: any, next: any) => {
  if (!req.timedout) next();
});

// ── OpenAPI docs ───────────────────────────────────────────────────────────

const swaggerDocument = YAML.load("./openapi.yaml");
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// ── API routes ─────────────────────────────────────────────────────────────

app.use("/api/meters", createMeterRouter(stellarService));
app.use("/api/payments", writeLimiter, paymentsLimiter, paymentsRouter);
app.use("/api/webhooks", writeLimiter, webhookRouter);
app.use("/api/collaborators", collaboratorRouter);
app.use("/api/allowlist", writeLimiter, allowlistRouter);
app.use("/api/stats", statsRouter);
app.use("/api/metrics", metricsRouter);

// ── Health check ───────────────────────────────────────────────────────────

app.get("/api/health", async (_req, res) => {
  const uptimeSec = Math.floor((Date.now() - startTime) / 1000);

  let rpcOk = false;
  try {
    await server.getLatestLedger();
    rpcOk = true;
  } catch {
    logger.warn("Stellar RPC health check failed");
  }

  const broker = process.env.MQTT_BROKER ?? "mqtt://localhost:1883";
  let mqttOk = false;
  try {
    const client = mqtt.connect(broker, { reconnectPeriod: 0, connectTimeout: 3000 });
    mqttOk = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { client.end(true); resolve(false); }, 3000);
      client.once("connect", () => { clearTimeout(timer); client.end(true); resolve(true); });
      client.once("error", () => { clearTimeout(timer); client.end(true); resolve(false); });
    });
  } catch {
    logger.warn("MQTT health check failed");
  }

  const healthy = rpcOk && mqttOk;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    version,
    uptimeSec,
    dependencies: {
      stellarRpc: rpcOk ? "ok" : "unreachable",
      mqtt: mqttOk ? "ok" : "unreachable",
    },
  });
});

// ── Error handlers ─────────────────────────────────────────────────────────

// 404 catch-all — must come after all routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: "Route not found",
    code: "NOT_FOUND",
    hint: "Check /api/docs for available endpoints",
  });
});

// Timeout handler
app.use((err: any, req: any, res: any, next: any) => {
  if (req.timedout) {
    logger.error("Request timed out", { method: req.method, path: req.path });
    return res.status(504).json({ error: "Request timed out", code: "TIMEOUT" });
  }
  next(err);
});

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err.message, stack: err.stack }, "Unhandled error");

  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large", code: "PAYLOAD_TOO_LARGE" });
  }
  if (err.type === "entity.parse.failed" || (err instanceof SyntaxError && (err as any).body !== undefined)) {
    return res.status(400).json({ error: "Invalid JSON body", code: "INVALID_JSON" });
  }
  if ((err as any).status === 404) {
    return res.status(404).json({ error: "Resource not found", code: "NOT_FOUND" });
  }
  if ((err as any).code === "VALIDATION_ERROR" && (err as any).details) {
    return res.status(400).json({ error: "Validation failed", code: "VALIDATION_ERROR", details: (err as any).details });
  }
  res.status(500).json({ error: err.message || "Internal server error", code: "INTERNAL_ERROR" });
});

// ── Bootstrap ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info({ port: PORT, network: process.env.STELLAR_NETWORK ?? "testnet" }, "SolarGrid backend started");
  initUsageEventStore();
  startUsageEventRetryWorker();

  try {
    startIoTBridge();
  } catch (err) {
    logger.error({ err }, "Failed to start IoT bridge");
  }

  startLimitWatcher(stellarService);
});
