import { AiStepError } from './errors';
import { readAiPolicy } from './config';
/** Check both limits and increment together, without reserving either if one is exhausted. */
export const RESERVE_AI_CALL_LUA = `
local userCap = tonumber(ARGV[1])
local globalCap = tonumber(ARGV[2])
local userCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local globalCount = tonumber(redis.call('GET', KEYS[2]) or '0')
if (userCap > 0 and userCount >= userCap) or (globalCap > 0 and globalCount >= globalCap) then return 0 end
for i = 1, 2 do
  local count = redis.call('INCR', KEYS[i])
  if count == 1 then redis.call('EXPIRE', KEYS[i], 172800) end
end
return 1
`;
export type BudgetEvaluator = (script: string, keys: string[], args: number[]) => Promise<unknown>;
export function createDailyBudget(
  evaluate: BudgetEvaluator,
  userId: number,
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
  warn: (message: string) => void = console.warn
): () => Promise<void> {
  if (!Number.isSafeInteger(userId) || userId < 1)
    throw new AiStepError('AI budget requires a valid workflow owner');
  const policy = readAiPolicy(env);
  return async () => {
    if (!policy.userCap && !policy.globalCap) return;
    const day = now().toISOString().slice(0, 10);
    let result: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      result = await Promise.race([
        evaluate(
          RESERVE_AI_CALL_LUA,
          [`ai:calls:user:${userId}:${day}`, `ai:calls:global:${day}`],
          [policy.userCap, policy.globalCap]
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Budget timeout')), 5000);
        }),
      ]);
    } catch {
      if (policy.failOpen) {
        warn('AI budget unavailable: explicit fail-open policy permits this attempt');
        return;
      }
      throw new AiStepError('AI budget service unavailable; no provider call was made');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (result === 0) throw new AiStepError('Daily AI call budget reached');
    if (result !== 1) throw new AiStepError('AI budget reservation failed');
  };
}
