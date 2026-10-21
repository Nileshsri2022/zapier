import request from 'supertest';
import express from 'express';
import client from '@repo/db';

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
    verify: jest.fn((token: string) => {
      if (token === 'user-1-token') return { id: 1 };
      throw new Error('invalid token');
    }),
  },
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn((token: string) => {
    if (token === 'user-1-token') return { id: 1 };
    throw new Error('invalid token');
  }),
}));

import { ZapRouter } from '../../src/routes/ZapRoutes';

/**
 * `PATCH /api/zaps/:zapId/filters` is the write half of the worker's filter
 * evaluation (#50): the worker now fails closed on an operator it cannot
 * evaluate, and this endpoint must never persist one in the first place.
 *
 * Asserted at the HTTP seam — the status and whether the row was touched are
 * the contract; the shape of a condition is already owned by
 * `StepConditionSchema` in @repo/types.
 */

const app = express();
app.use(express.json());
app.use('/api/zaps', ZapRouter);

const patchFilters = (filterConditions: unknown) =>
  request(app)
    .patch('/api/zaps/zap-1/filters')
    .set('Authorization', 'Bearer user-1-token')
    .send({ filterConditions });

const observedCondition = { field: 'from', operator: 'equals', value: 'billing@acme.com' };

beforeEach(() => {
  jest.clearAllMocks();
  (client.zap.findFirst as jest.Mock).mockResolvedValue({ id: 'zap-1', userId: 1 });
  (client.zap.update as jest.Mock).mockImplementation(async ({ data }: any) => ({
    id: 'zap-1',
    filterConditions: data.filterConditions,
  }));
});

describe('PATCH /api/zaps/:zapId/filters — operator validation', () => {
  it('rejects an operator the worker cannot evaluate', async () => {
    const res = await patchFilters([{ ...observedCondition, operator: 'regex' }]);

    expect(res.status).toBe(422);
    expect(client.zap.update).not.toHaveBeenCalled();
  });

  it('rejects a near-miss typo of a supported operator', async () => {
    const res = await patchFilters([{ ...observedCondition, operator: 'equal' }]);

    expect(res.status).toBe(422);
    expect(client.zap.update).not.toHaveBeenCalled();
  });

  it('rejects prototype-pollution keys in the field path', async () => {
    const res = await patchFilters([{ ...observedCondition, field: '__proto__' }]);

    expect(res.status).toBe(422);
    expect(client.zap.update).not.toHaveBeenCalled();
  });

  it('rejects a condition with no field', async () => {
    const res = await patchFilters([{ ...observedCondition, field: '' }]);

    expect(res.status).toBe(422);
    expect(client.zap.update).not.toHaveBeenCalled();
  });

  it('rejects more conditions than the evaluator accepts', async () => {
    const tooMany = Array.from({ length: 21 }, () => observedCondition);

    const res = await patchFilters(tooMany);

    expect(res.status).toBe(422);
    expect(client.zap.update).not.toHaveBeenCalled();
  });

  it('rejects a body whose filterConditions is not an array', async () => {
    const res = await patchFilters({ field: 'from', operator: 'equals' });

    expect(res.status).toBe(422);
    expect(client.zap.update).not.toHaveBeenCalled();
  });

  it('accepts every operator the worker documents', async () => {
    const documented = [
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
    ].map((operator) => ({ field: 'subject', operator, value: 'x' }));

    const res = await patchFilters(documented);

    expect(res.status).toBe(200);
    expect(client.zap.update).toHaveBeenCalledTimes(1);
    expect(res.body.data.filterConditions).toHaveLength(12);
  });

  it('still persists a valid filter set', async () => {
    const res = await patchFilters([observedCondition]);

    expect(res.status).toBe(200);
    expect(client.zap.update).toHaveBeenCalledWith({
      where: { id: 'zap-1' },
      data: { filterConditions: [observedCondition] },
    });
  });
});
