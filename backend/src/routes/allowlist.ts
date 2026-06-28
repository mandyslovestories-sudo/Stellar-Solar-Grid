import { Router } from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import { contractQuery, adminInvoke } from '../lib/stellar.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAdminKey } from '../middleware/adminAuth.js';

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

/**
 * POST /api/allowlist/bulk — add multiple addresses in a single request.
 * Accepts up to 50 addresses; validates each as a Stellar Ed25519 public key.
 * Returns per-address results; partial success is allowed.
 *
 * Closes #464.
 */
allowlistRouter.post('/bulk', requireAdminKey, asyncHandler(async (req, res) => {
  const { addresses } = req.body as { addresses?: unknown };

  if (!Array.isArray(addresses) || addresses.length === 0) {
    return res.status(400).json({ error: 'addresses must be a non-empty array', code: 'VALIDATION_ERROR' });
  }
  if (addresses.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 addresses per request', code: 'VALIDATION_ERROR' });
  }

  const results: Array<{ address: string; hash?: string; error?: string }> = [];

  for (const addr of addresses) {
    if (typeof addr !== 'string') {
      results.push({ address: String(addr), error: 'Invalid address type' });
      continue;
    }
    try {
      StellarSdk.StrKey.decodeEd25519PublicKey(addr);
    } catch {
      results.push({ address: addr, error: 'Invalid Stellar public key' });
      continue;
    }
    try {
      const hash = await adminInvoke('add_to_allowlist', [
        StellarSdk.nativeToScVal(addr, { type: 'address' }),
      ]);
      results.push({ address: addr, hash: hash as string });
    } catch (err: any) {
      results.push({ address: addr, error: err.message });
    }
  }

  return res.json({ results });
import { stellarService } from '../lib/stellar.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAdminKey } from '../middleware/adminAuth.js';
import { z } from 'zod';

export const allowlistRouter = Router();
const AddressSchema = z.object({ address: z.string().length(56) });

allowlistRouter.get('/', asyncHandler(async (_req, res) => {
  const result = await stellarService.query('get_allowlist', []);
  res.json({ addresses: StellarSdk.scValToNative(result) });
}));

allowlistRouter.post('/', requireAdminKey, asyncHandler(async (req, res) => {
  const { address } = AddressSchema.parse(req.body);
  const hash = await stellarService.invoke('allowlist_add', [
    StellarSdk.nativeToScVal(address, { type: 'address' }),
  ]);
  res.json({ hash });
}));

allowlistRouter.delete('/:address', requireAdminKey, asyncHandler(async (req, res) => {
  const hash = await stellarService.invoke('allowlist_remove', [
    StellarSdk.nativeToScVal(req.params.address, { type: 'address' }),
  ]);
  res.json({ hash });
}));
