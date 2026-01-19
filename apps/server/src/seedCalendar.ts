import client from '@repo/db';

// Script to insert or update Google Calendar trigger types
async function seedCalendarTriggers() {
  const calendarIcon = 'https://cdn-icons-png.flaticon.com/48/2965/2965879.png';

  const calendarTriggers = [
    'Google Calendar New Event',
    'Google Calendar Event Updated',
    'Google Calendar Event Start',
    'Google Calendar Event Ended',
    'Google Calendar Event Cancelled',
    'Google Calendar New Calendar',
    'Google Calendar Event Matching Search',
  ];

  for (const type of calendarTriggers) {
    await client.availableTriggers.upsert({
      where: { type },
      create: { type, image: calendarIcon },
      update: { image: calendarIcon },
    });
    console.log(`✅ Upserted: ${type}`);
  }

  console.log('\n📅 Google Calendar triggers seeded successfully!');
  await client.$disconnect();
}

seedCalendarTriggers();
