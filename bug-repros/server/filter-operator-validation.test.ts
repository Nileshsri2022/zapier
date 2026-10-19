/**
 * BUG: Zap-level `filterConditions` (PATCH /api/zaps/:zapId/filters) are stored
 * after only a `field`/`operator` presence check. The operator vocabulary is
 * never validated against the enum the worker implements
 * (`StepConditionSchema` in packages/types/src/index.ts has the full list), so a
 * typo'd or hostile operator is persisted. `apps/worker/src/utils/evaluateFilters.ts`
 * then falls through its switch and returns `pass` — the filter silently lets
 * EVERY event through instead of rejecting an operator it cannot evaluate.
 *
 * Expected (green): an unknown operator is rejected at the API boundary.
 */
import { Response } from 'express';
import client from '@repo/db';
import { updateZapFilters } from '../../apps/server/src/controllers/ZapController';

const makeRes = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
};

const callWith = (filterConditions: any) => {
  const { res, status, json } = makeRes();
  const req = {
    params: { zapId: 'zap-1' },
    body: { filterConditions },
    // @ts-ignore - set by authMiddleware
    id: '1',
  };
  return { req, res, status, json };
};

beforeEach(() => {
  jest.clearAllMocks();
  (client.zap.findFirst as jest.Mock).mockResolvedValue({ id: 'zap-1', userId: 1 });
  (client.zap.update as jest.Mock).mockImplementation(async ({ data }: any) => ({
    id: 'zap-1',
    ...data,
  }));
});

describe('PATCH /api/zaps/:zapId/filters operator validation', () => {
  const KNOWN_OPERATORS = [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'greater_than',
    'less_than',
    'greater_than_or_equals',
    'less_than_or_equals',
    'is_empty',
    'is_not_empty',
    'starts_with',
    'ends_with',
  ];

  it('rejects an operator the worker cannot evaluate', async () => {
    const { req, res, status } = callWith([
      { field: 'payload.sender.login', operator: 'regex', value: '.*' },
    ]);

    await updateZapFilters(req as any, res);

    // Today this returns 200 and persists `regex`; the worker then fails open.
    expect(status).toHaveBeenCalledWith(400);
    expect(client.zap.update).not.toHaveBeenCalled();
  });

  it('rejects prototype-pollution keys the same way step conditions do', async () => {
    const { req, res, status } = callWith([
      { field: '__proto__', operator: 'equals', value: 'x' },
    ]);

    await updateZapFilters(req as any, res);

    expect(status).toHaveBeenCalledWith(400);
  });

  it('accepts the documented operator vocabulary', async () => {
    for (const operator of KNOWN_OPERATORS) {
      const { req, res, status } = callWith([{ field: 'payload.ref', operator, value: 'main' }]);
      jest.clearAllMocks();
      (client.zap.findFirst as jest.Mock).mockResolvedValue({ id: 'zap-1', userId: 1 });
      (client.zap.update as jest.Mock).mockResolvedValue({ id: 'zap-1' });

      await updateZapFilters(req as any, res);

      expect(status).toHaveBeenCalledWith(200);
    }
  });
});
