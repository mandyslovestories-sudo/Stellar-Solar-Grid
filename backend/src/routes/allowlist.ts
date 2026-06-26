import { Router } from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import { contractQuery, adminInvoke } from '../lib/stellar.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const allowlistRouter = Router();

allowlistRouter.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt((req.query.limit as string) ?? '50', 10)));
  const raw = await contractQuery('get_allowlist', []);
  const all: string[] = (StellarSdk.scValToNative(raw) as string[]) ?? [];
  const start = (page - 1) * limit;
  const data = all.slice(start, start + limit);
  return res.json({ data, total: all.length, page, limit });
}));

allowlistRouter.post('/', asyncHandler(async (req, res) => {
  const { address } = req.body as { address?: string };
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'address is required', code: 'VALIDATION_ERROR' });
  }
  try {
    StellarSdk.StrKey.decodeEd25519PublicKey(address);
  } catch {
    return res.status(400).json({ error: 'Invalid Stellar address', code: 'VALIDATION_ERROR' });
  }
  const hash = await adminInvoke('add_to_allowlist', [
    StellarSdk.nativeToScVal(address, { type: 'address' }),
  ]);
  return res.json({ hash });
}));

allowlistRouter.delete('/', asyncHandler(async (req, res) => {
  const { address } = req.body as { address?: string };
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'address is required', code: 'VALIDATION_ERROR' });
  }
  const hash = await adminInvoke('remove_from_allowlist', [
    StellarSdk.nativeToScVal(address, { type: 'address' }),
  ]);
  return res.json({ hash });
}));
