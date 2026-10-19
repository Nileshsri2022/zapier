/** Run with tsx from apps/server. Dry-run by default; --apply writes CAS updates. */
import 'dotenv/config';
import client from '@repo/db';
import { CredentialVault } from '@repo/ai-connections';

async function main() {
  const vault = CredentialVault.fromEnv();
  const apply = process.argv.includes('--apply');
  let cursor: string | undefined;
  let checked = 0;
  let updated = 0;
  let conflicts = 0;
  for (;;) {
    const rows = await client.aiConnection.findMany({
      where: { keyId: { not: vault.activeKeyId } },
      take: 100,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      if (row.provider !== 'openai_compatible') throw new Error('Unsupported connection provider');
      const encrypted = vault.rotate({ ...row, provider: 'openai_compatible' });
      checked++;
      if (apply) {
        const result = await client.aiConnection.updateMany({
          where: { id: row.id, keyId: row.keyId, updatedAt: row.updatedAt },
          data: {
            ...encrypted,
            updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)),
          },
        });
        if (result.count === 1) updated++;
        else conflicts++;
      }
    }
    cursor = rows[rows.length - 1]!.id;
  }
  console.log(JSON.stringify({ dryRun: !apply, checked, updated, conflicts }));
}
main()
  .catch(() => {
    // Never echo the row, keyring, credential or raw Prisma error.
    console.error('AI credential rotation failed. Retain old keys and investigate securely.');
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
