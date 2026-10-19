import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

export function aiOwner(req: Request): number {
  const id = Number((req as Request & { id?: unknown }).id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid authenticated owner');
  return id;
}
function sign(req: Request, payload: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 10) throw new Error('AI request protection unavailable');
  const session = createHash('sha256')
    .update(String(req.cookies?.auth_token || ''))
    .digest('hex');
  return createHmac('sha256', secret)
    .update(`ai-csrf:v1:${aiOwner(req)}:${session}:${payload}`)
    .digest('hex');
}
export function getAiCsrf(req: Request, res: Response) {
  try {
    const payload = `${Date.now() + 30 * 60 * 1000}.${randomBytes(24).toString('hex')}`;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ csrfToken: `${payload}.${sign(req, payload)}` });
  } catch {
    res.status(503).json({ message: 'AI request protection unavailable' });
  }
}
/** Authentication MUST run first. Cookie wins in authMiddleware, so mixed auth still requires CSRF. */
export function aiCsrf(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  if (
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
    (!req.cookies?.auth_token && req.headers.authorization?.startsWith('Bearer '))
  )
    return next();
  try {
    const token = req.headers['x-ai-csrf'];
    if (typeof token !== 'string' || token.length > 200) throw new Error();
    const [expiry, nonce, mac, extra] = token.split('.');
    if (
      extra ||
      !expiry ||
      !/^\d+$/.test(expiry) ||
      Number(expiry) <= Date.now() ||
      Number(expiry) > Date.now() + 30 * 60 * 1000 ||
      !nonce ||
      !/^[a-f0-9]{48}$/.test(nonce) ||
      !mac ||
      !/^[a-f0-9]{64}$/.test(mac)
    )
      throw new Error();
    if (
      !timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(sign(req, `${expiry}.${nonce}`), 'hex'))
    )
      throw new Error();
    next();
  } catch {
    res.status(403).json({ message: 'Missing or invalid AI CSRF token; refresh and retry' });
  }
}
