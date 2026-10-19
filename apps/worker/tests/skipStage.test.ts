import { advanceSkippedStage } from '../src/utils/skipStage';
test('skipped non-final action advances, skipped final action completes', async () => {
  const next = jest.fn(async () => {});
  const complete = jest.fn(async () => {});
  await advanceSkippedStage(2, 3, next, complete);
  expect(next).toHaveBeenCalledTimes(1);
  expect(complete).not.toHaveBeenCalled();
  await advanceSkippedStage(3, 3, next, complete);
  expect(next).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledTimes(1);
});
