import client from '@repo/db';

async function seedDatabase() {
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

    // Seed available actions
    const actions = await client.availableActions.createMany({
      data: [
        {
          type: 'Email',
          image: '/apps/email.svg',
        },
        {
          type: 'Solana',
          image: '/apps/Solena.svg',
        },
        {
          type: 'Gmail Send Email',
          image: '/apps/email.svg',
        },
        {
          type: 'Gmail Reply',
          image: '/apps/email.svg',
        },
        {
          type: 'Gmail Add Label',
          image: '/apps/email.svg',
        },
        {
          type: 'Gmail Remove Label',
          image: '/apps/email.svg',
        },
        {
          type: 'Gmail Mark as Read',
          image: '/apps/email.svg',
        },
        {
          type: 'Gmail Archive',
          image: '/apps/email.svg',
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
      ],
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
        console.warn(
          `   - Zap "${row.zap.name}" (${row.zap.id}) — trigger: ${row.trigger.type}`
        );
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

    console.log('Database seeded successfully!');
    console.log(`Created ${triggers.count} triggers and ${actions.count} actions`);
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await client.$disconnect();
  }
}

seedDatabase();
