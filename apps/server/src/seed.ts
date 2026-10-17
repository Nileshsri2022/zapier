import client from '@repo/db';

async function seedDatabase() {
  try {
    // Seed available triggers
    const triggers = await client.availableTriggers.createMany({
      data: [
        {
          type: 'Webhook',
          image: 'https://img.icons8.com/ios-filled/50/webhook.png',
        },
        {
          type: 'Gmail New Email',
          image: 'https://img.icons8.com/ios-filled/50/email.png',
        },
        {
          type: 'Gmail Labeled',
          image: 'https://img.icons8.com/ios-filled/50/email.png',
        },
        {
          type: 'Gmail Starred',
          image: 'https://img.icons8.com/ios-filled/50/email.png',
        },
        {
          type: 'Gmail From Sender',
          image: 'https://img.icons8.com/ios-filled/50/email.png',
        },
        {
          type: 'GitHub Push',
          image: 'https://img.icons8.com/ios-filled/50/github.png',
        },
        {
          type: 'GitHub Pull Request',
          image: 'https://img.icons8.com/ios-filled/50/github.png',
        },
        {
          type: 'GitHub Issue',
          image: 'https://img.icons8.com/ios-filled/50/github.png',
        },
        {
          type: 'GitHub Release',
          image: 'https://img.icons8.com/ios-filled/50/github.png',
        },
        {
          type: 'Google Sheets Updated Row',
          image: 'https://img.icons8.com/color/48/google-sheets.png',
        },
        {
          type: 'WhatsApp Message Received',
          image: 'https://img.icons8.com/color/48/whatsapp.png',
        },
        {
          type: 'Telegram New Message',
          image: 'https://img.icons8.com/color/48/telegram-app.png',
        },
        {
          type: 'Schedule Every Minute',
          image: 'https://img.icons8.com/ios-filled/50/schedule.png',
        },
        {
          type: 'Schedule Every Hour',
          image: 'https://img.icons8.com/ios-filled/50/schedule.png',
        },
        {
          type: 'Schedule Every Day',
          image: 'https://img.icons8.com/ios-filled/50/schedule.png',
        },
        {
          type: 'Schedule Every Week',
          image: 'https://img.icons8.com/ios-filled/50/schedule.png',
        },
        {
          type: 'Schedule Every Month',
          image: 'https://img.icons8.com/ios-filled/50/schedule.png',
        },
        // Google Calendar Triggers
        {
          type: 'Google Calendar New Event',
          image: 'https://cdn-icons-png.flaticon.com/48/2965/2965879.png',
        },
        {
          type: 'Google Calendar Event Updated',
          image: 'https://cdn-icons-png.flaticon.com/48/2965/2965879.png',
        },
        {
          type: 'Google Calendar Event Start',
          image: 'https://cdn-icons-png.flaticon.com/48/2965/2965879.png',
        },
        {
          type: 'Google Calendar Event Ended',
          image: 'https://cdn-icons-png.flaticon.com/48/2965/2965879.png',
        },
        {
          type: 'Google Calendar Event Cancelled',
          image: 'https://cdn-icons-png.flaticon.com/48/2965/2965879.png',
        },
        {
          type: 'Google Calendar New Calendar',
          image: 'https://cdn-icons-png.flaticon.com/48/2965/2965879.png',
        },
        {
          type: 'Google Calendar Event Matching Search',
          image: 'https://cdn-icons-png.flaticon.com/48/2965/2965879.png',
        },
      ],
      skipDuplicates: true,
    });

    // Seed available actions
    const actions = await client.availableActions.createMany({
      data: [
        {
          type: 'Email',
          image: 'https://img.icons8.com/ios-filled/50/email.png',
        },
        {
          type: 'Solana',
          image: 'https://cryptologos.cc/logos/solana-sol-logo.png?v=029',
        },
        {
          type: 'Gmail Send Email',
          image: 'https://img.icons8.com/ios-filled/50/email.png',
        },
        {
          type: 'Gmail Reply',
          image: 'https://img.icons8.com/ios-filled/50/email.png',
        },
        {
          type: 'Gmail Add Label',
          image: 'https://img.icons8.com/ios-filled/50/email.png',
        },
        {
          type: 'Gmail Remove Label',
          image: 'https://img.icons8.com/ios-filled/50/email.png',
        },
        {
          type: 'Gmail Mark as Read',
          image: 'https://img.icons8.com/ios-filled/50/email.png',
        },
        {
          type: 'Gmail Archive',
          image: 'https://img.icons8.com/ios-filled/50/email.png',
        },
        {
          type: 'WhatsApp Send Message',
          image: 'https://img.icons8.com/color/48/whatsapp.png',
        },
        {
          type: 'Telegram Send Message',
          image: 'https://img.icons8.com/color/48/telegram-app.png',
        },
        {
          type: 'Webhook',
          image: 'https://img.icons8.com/ios-filled/50/webhook.png',
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
