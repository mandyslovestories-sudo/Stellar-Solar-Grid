import { Router } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { stellarService } from "../lib/stellar.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { register } from "../lib/metrics.js";

export const statsRouter = Router();

// Cache for the existing contract-based stats endpoint (30s TTL)
let contractCache: { data: object; expiresAt: number } | null = null;

// Cache for the prom-client metrics summary endpoint (15s TTL)
let metricsCache: { data: object; expiresAt: number } | null = null;

// Cache for meters-by-plan breakdown (30s TTL)
let metersByPlanCache: { data: object; expiresAt: number } | null = null;

/**
 * GET /api/stats — contract-derived meter statistics (existing endpoint)
 */
statsRouter.get("/", asyncHandler(async (_req, res) => {
  if (contractCache && Date.now() < contractCache.expiresAt) {
    return res.json(contractCache.data);
  }

  const result = await stellarService.query("get_all_meters", []);
  const meters = (StellarSdk.scValToNative(result) as any[]) ?? [];
  const total = meters.length;
  const active = meters.filter((m: any) => m.active).length;
  const units = meters.reduce((s: number, m: any) => s + Number(m.units_used), 0);

  let revenue = 0;
  const adminAddr = process.env.ADMIN_ADDRESS;
  if (adminAddr) {
    const rev = await stellarService.query("get_provider_revenue", [
      StellarSdk.nativeToScVal(adminAddr, { type: "address" }),
    ]);
    revenue = Number(StellarSdk.scValToNative(rev));
  }

  const data = {
    totalMeters: total,
    activeMeters: active,
    totalUnits: units,
    totalRevenue: revenue,
  };
  contractCache = { data, expiresAt: Date.now() + 30_000 };
  res.json(data);
}));

/**
 * GET /api/stats/meters-by-plan — meter count breakdown by plan type.
 * Returns zero counts for plan types with no meters.
 * Cached for 30 seconds.
 *
 * Closes #461.
 */
statsRouter.get("/meters-by-plan", asyncHandler(async (_req, res) => {
  if (metersByPlanCache && Date.now() < metersByPlanCache.expiresAt) {
    return res.json(metersByPlanCache.data);
  }

  const result = await stellarService.query("get_all_meters", []);
  const meters = (StellarSdk.scValToNative(result) as any[]) ?? [];

  const counts: Record<string, number> = { Daily: 0, Weekly: 0, Usage: 0 };
  for (const meter of meters) {
    const plan = String(meter.plan);
    if (plan in counts) counts[plan]++;
  }

  const data = { ...counts, total: meters.length };
  metersByPlanCache = { data, expiresAt: Date.now() + 30_000 };
  res.json(data);
}));

/**
 * GET /api/stats/summary — prom-client counter/gauge snapshot for the admin
 * dashboard. Does not require Prometheus or Grafana to be running.
 * Response is cached for 15 seconds.
 *
 * Closes #344.
 */
statsRouter.get("/summary", asyncHandler(async (_req, res) => {
  if (metricsCache && Date.now() < metricsCache.expiresAt) {
    return res.json(metricsCache.data);
  }

  const metrics = await register.getMetricsAsJSON();

  const find = (name: string): number => {
    const metric = metrics.find((m: any) => m.name === name);
    return metric?.values?.[0]?.value ?? 0;
  };

  const data = {
    mqttMessages: find("solargrid_mqtt_messages_total"),
    contractCalls: find("solargrid_contract_invocations_total"),
    activeMeters: find("solargrid_active_meters"),
    paymentVolumeXlm: find("solargrid_payment_volume_xlm"),
  };

  metricsCache = { data, expiresAt: Date.now() + 15_000 };
  res.json(data);
}));
