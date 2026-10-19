import client from '@repo/db';

/**
 * Action catalog entries seeded into `AvailableActions`.
 *
 * Every entry here MUST be executable by `apps/worker` (matched by
 * `isKnownActionType` in `apps/worker/src/utils/actionTypes.ts`). Unimplemented
 * Gmail actions were previously seeded here and either faked `success: true`
 * (before F3) or failed at runtime (after F3); see gap D2 / F4 in
 * `reports/workflow-execution-gaps.md`.
 */
export const SEEDED_ACTIONS = [
  { type: 'AI Transform', image: '/apps/ai.svg' },
  {
    type: 'Email',
    image: '/apps/email.svg',
  },
  {
    type: 'Solana',
    image: '/apps/Solana.svg',
  },
  {
    type: 'WhatsApp Send Message',
    image: '/apps/whatsapp.svg',
  },
  {
    type: 'Telegram Send Message',
    image: '/apps/telegram.svg',
  },
  {
    type: 'Webhook',
    image: '/apps/webhook.svg',
  },
] as const;

export const SEEDED_ACTION_TYPES = SEEDED_ACTIONS.map((a) => a.type);

/**
 * Unimplemented Gmail action types formerly seeded into `AvailableActions`.
 * Removed from the catalog in F4 so users cannot select actions the worker
 * does not implement.
 */
export const UNIMPLEMENTED_GMAIL_ACTIONS = [
  'Gmail Send Email',
  'Gmail Reply',
  'Gmail Add Label',
  'Gmail Remove Label',
  'Gmail Mark as Read',
  'Gmail Archive',
] as const;

export async function seedDatabase() {
  try {
    // Seed available triggers
    const triggers = await client.availableTriggers.createMany({
      data: [
        {
          type: 'Webhook',
          image: '/apps/webhook.svg',
        },
        {
          type: 'Gmail New Email',
          image: '/apps/email.svg',
        },
        {
          type: 'Gmail Labeled',
          image: '/apps/email.svg',
        },
        {
          type: 'Gmail Starred',
          image: '/apps/email.svg',
        },
        {
          type: 'Gmail From Sender',
          image: '/apps/email.svg',
        },
        {
          type: 'GitHub Push',
          image: '/apps/github.svg',
        },
        {
          type: 'GitHub Pull Request',
          image: '/apps/github.svg',
        },
        {
          type: 'GitHub Issue',
          image: '/apps/github.svg',
        },
        {
          type: 'GitHub Release',
          image: '/apps/github.svg',
        },
        {
          type: 'Google Sheets Updated Row',
          image: '/apps/sheets.svg',
        },
        {
          type: 'WhatsApp Message Received',
          image: '/apps/whatsapp.svg',
        },
        {
          type: 'Telegram New Message',
          image: '/apps/telegram.svg',
        },
        {
          type: 'Schedule Every Minute',
          image: '/apps/schedule.svg',
        },
        {
          type: 'Schedule Every Hour',
          image: '/apps/schedule.svg',
        },
        {
          type: 'Schedule Every Day',
          image: '/apps/schedule.svg',
        },
        {
          type: 'Schedule Every Week',
          image: '/apps/schedule.svg',
        },
        {
          type: 'Schedule Every Month',
          image: '/apps/schedule.svg',
        },
        // Google Calendar Triggers
        {
          type: 'Google Calendar New Event',
          image: '/apps/calendar.svg',
        },
        {
          type: 'Google Calendar Event Updated',
          image: '/apps/calendar.svg',
        },
        {
          type: 'Google Calendar Event Start',
          image: '/apps/calendar.svg',
        },
        {
          type: 'Google Calendar Event Ended',
          image: '/apps/calendar.svg',
        },
        {
          type: 'Google Calendar Event Cancelled',
          image: '/apps/calendar.svg',
        },
        {
          type: 'Google Calendar New Calendar',
          image: '/apps/calendar.svg',
        },
        {
          type: 'Google Calendar Event Matching Search',
          image: '/apps/calendar.svg',
        },
      ],
      skipDuplicates: true,
    });

    // Seed available actions (only actions implemented by apps/worker)
    const actions = await client.availableActions.createMany({
      data: [...SEEDED_ACTIONS],
      skipDuplicates: true,
    });

    // Legacy detection: find zaps still wired to an Email/Solana trigger.
    // No runtime path ever fires these trigger types (no SMTP receiver, no
    // Solana block-listener), so such zaps are permanently dormant. Deactivate
    // them so dashboards don't show dead zaps as armed, and warn so operators
    // (and users, via the zap ID list) can rebuild them with a supported trigger.
    type DeadTriggerRow = {
      trigger: { type: string };
      zap: { id: string; name: string; isActive: boolean };
    };

    const deadTriggerRows: DeadTriggerRow[] = await client.trigger.findMany({
      where: {
        trigger: { type: { in: ['Email', 'Solana'] } },
      },
      select: {
        trigger: { select: { type: true } },
        zap: { select: { id: true, name: true, isActive: true } },
      },
    });

    if (deadTriggerRows.length > 0) {
      console.warn(
        `⚠️  ${deadTriggerRows.length} zap(s) use legacy Email/Solana triggers that can never fire:`
      );
      for (const row of deadTriggerRows) {
        console.warn(`   - Zap "${row.zap.name}" (${row.zap.id}) — trigger: ${row.trigger.type}`);
      }

      const activeDeadZapIds = deadTriggerRows
        .filter((row) => row.zap.isActive)
        .map((row) => row.zap.id);

      if (activeDeadZapIds.length > 0) {
        const deactivated = await client.zap.updateMany({
          where: { id: { in: activeDeadZapIds } },
          data: { isActive: false },
        });
        console.warn(
          `⚠️  Deactivated ${deactivated.count} dead zap(s) (Email/Solana trigger is unimplemented)`
        );
      }
    }

    // Legacy cleanup: 'Email' and 'Solana' were originally seeded as triggers,
    // but they were only ever implemented as actions (sending email via Resend,
    // sending SOL via web3). No inbound SMTP server or Solana block-listener
    // exists to fire them, so remove them from the trigger catalog — unless an
    // existing Zap still references them via a Trigger row.
    const removedLegacyTriggers = await client.availableTriggers.deleteMany({
      where: {
        type: { in: ['Email', 'Solana'] },
        trigger: { none: {} },
      },
    });
    if (removedLegacyTriggers.count > 0) {
      console.log(
        `Removed ${removedLegacyTriggers.count} legacy trigger entr(ies): Email, Solana (implemented as actions only)`
      );
    }

    // F4 / Gap D2 cleanup: Gmail actions were previously seeded into
    // AvailableActions before worker executors existed. Deactivate any armed
    // Zaps referencing them and prune unreferenced catalog rows so the UI only
    // offers actions the worker can actually execute.
    type DeadActionRow = {
      action: { type: string };
      zap: { id: string; name: string; isActive: boolean };
    };

    const deadActionRows: DeadActionRow[] = await client.action.findMany({
      where: {
        action: { type: { in: [...UNIMPLEMENTED_GMAIL_ACTIONS] } },
      },
      select: {
        action: { select: { type: true } },
        zap: { select: { id: true, name: true, isActive: true } },
      },
    });

    if (deadActionRows.length > 0) {
      console.warn(
        `⚠️  ${deadActionRows.length} action step(s) reference unimplemented Gmail actions:`
      );
      for (const row of deadActionRows) {
        console.warn(`   - Zap "${row.zap.name}" (${row.zap.id}) — action: ${row.action.type}`);
      }

      const activeDeadActionZapIds = Array.from(
        new Set(deadActionRows.filter((row) => row.zap.isActive).map((row) => row.zap.id))
      );

      if (activeDeadActionZapIds.length > 0) {
        const deactivated = await client.zap.updateMany({
          where: { id: { in: activeDeadActionZapIds } },
          data: { isActive: false },
        });
        console.warn(
          `⚠️  Deactivated ${deactivated.count} zap(s) using unimplemented Gmail actions`
        );
      }
    }

    const removedUnimplementedActions = await client.availableActions.deleteMany({
      where: {
        type: { in: [...UNIMPLEMENTED_GMAIL_ACTIONS] },
        action: { none: {} },
      },
    });
    if (removedUnimplementedActions.count > 0) {
      console.log(
        `Removed ${removedUnimplementedActions.count} unimplemented Gmail action catalog entr(ies)`
      );
    }

    console.log('Database seeded successfully!');
    console.log(`Created ${triggers.count} triggers and ${actions.count} actions`);
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await client.$disconnect();
  }
}

if (require.main === module) {
  seedDatabase();
}
