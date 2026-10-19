import client from '@repo/db';
import { createAiConnectionService } from '@repo/ai-connections';
export { validateAiConnectionEnvironment } from '@repo/ai-connections';

export function getAiConnectionService() {
  return createAiConnectionService(client);
}
