import "dotenv/config";
import express from "express";
import cors from "cors";
import { meterRouter } from "./routes/meters.js";
import { paymentsRouter } from "./routes/payments.js";
import { webhookRouter } from "./routes/webhooks.js";
import { startIoTBridge } from "./iot/bridge.js";
import { logger } from "./lib/logger.js";
import requestLogger from "./middleware/requestLogger.js";

const REQUIRED_ENV = ["CONTRACT_ID", "ADMIN_SECRET_KEY"];
const PORT = process.env.PORT ?? 3001;

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  logger.fatal(
    { missing },
    "Missing required environment variables. Copy backend/.env.example to backend/.env."
  );
  process.exit(1);
}

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Key"],
    optionsSuccessStatus: 204,
  })
);

// Capture raw body for webhook signature verification before JSON parsing
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(requestLogger);

app.use("/api/meters", meterRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/webhooks", webhookRouter);

app.get("/health", (_, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  logger.info(
    { port: PORT, network: process.env.STELLAR_NETWORK ?? "testnet" },
    "SolarGrid backend started"
  );
  startIoTBridge();
});
