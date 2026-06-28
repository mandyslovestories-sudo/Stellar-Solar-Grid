import client, { Counter, Gauge, Histogram, Registry } from "prom-client";

// Single shared registry for the whole process
export const register = new Registry();

// Collect default Node.js metrics (GC, memory, CPU, event loop lag, etc.)
client.collectDefaultMetrics({ register });

// ── HTTP instrumentation ───────────────────────────────────────────────────

/**
 * Histogram that tracks HTTP request duration.
 * Labels: method (GET/POST/…), route (req.path), status (200/404/…)
 * Buckets cover fast API responses up to slow contract calls.
 */
export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// ── Domain metrics ─────────────────────────────────────────────────────────

export const mqttMessages = new Counter({
  name: "solargrid_mqtt_messages_total",
  help: "Total MQTT messages received",
  registers: [register],
});

export const contractCalls = new Counter({
  name: "solargrid_contract_invocations_total",
  help: "Contract calls by method and status",
  labelNames: ["method", "status"] as const,
  registers: [register],
});

export const activeMeters = new Gauge({
  name: "solargrid_active_meters",
  help: "Number of currently active meters",
  registers: [register],
});

export const paymentVolume = new Counter({
  name: "solargrid_payment_volume_xlm",
  help: "Total XLM processed in payments",
  registers: [register],
});
