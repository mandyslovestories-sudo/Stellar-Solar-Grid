import { Request, Response, NextFunction, RequestHandler } from 'express';

export function validateRequest(
  validator: (body: unknown) => { valid: boolean; error?: string }
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = validator(req.body);
    if (!result.valid) {
      res.status(400).json({ error: result.error ?? 'Invalid request body' });
      return;
    }
    next();
  };
}
