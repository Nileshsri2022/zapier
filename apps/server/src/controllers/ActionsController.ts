import client from '@repo/db';
import type { Response, Request } from 'express';

export const fetchAvailableActions = async (req: Request, res: Response): Promise<any> => {
  const availableActions = await client.availableActions.findMany();

  return res.status(200).json({
    message: 'Fetched available actions',
    availableActions,
  });
};

// The server-inline action executor (`executeAction` — SMTP Email via
// nodemailer, a placeholder Solana that only logged, and Gmail* helpers)
// was deleted in gmail-worker-routing-spec P5. apps/worker is now the
// single place that executes Zap actions; this controller only serves
// the action catalog. GmailActionsController's helpers remain for a
// separate disposition decision (see the spec's follow-ups).
