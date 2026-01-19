import client from "@repo/db";

async function seedDatabase() {
    try {
        // Seed available triggers
        const triggers = await client.availableTriggers.createMany({
            data: [
                {
                    type: "Webhook",
                    image: "https://img.icons8.com/ios-filled/50/webhook.png"
                },
                {
                    type: "Email",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "Solana",
                    image: "https://img.icons8.com/ios-filled/50/solana.png"
                },
                {
                    type: "Gmail New Email",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "Gmail Labeled",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "Gmail Starred",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "Gmail From Sender",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "GitHub Push",
                    image: "https://img.icons8.com/ios-filled/50/github.png"
                },
                {
                    type: "GitHub Pull Request",
                    image: "https://img.icons8.com/ios-filled/50/github.png"
                },
                {
                    type: "GitHub Issue",
                    image: "https://img.icons8.com/ios-filled/50/github.png"
                },
                {
                    type: "GitHub Release",
                    image: "https://img.icons8.com/ios-filled/50/github.png"
                },
                {
                    type: "Google Sheets Updated Row",
                    image: "https://img.icons8.com/color/48/google-sheets.png"
                },
                {
                    type: "WhatsApp Message Received",
                    image: "https://img.icons8.com/color/48/whatsapp.png"
                },
                {
                    type: "Telegram New Message",
                    image: "https://img.icons8.com/color/48/telegram-app.png"
                },
                {
                    type: "Schedule Every Hour",
                    image: "https://img.icons8.com/ios-filled/50/schedule.png"
                },
                {
                    type: "Schedule Every Day",
                    image: "https://img.icons8.com/ios-filled/50/schedule.png"
                },
                {
                    type: "Schedule Every Week",
                    image: "https://img.icons8.com/ios-filled/50/schedule.png"
                },
                {
                    type: "Schedule Every Month",
                    image: "https://img.icons8.com/ios-filled/50/schedule.png"
                }
            ],
            skipDuplicates: true
        });

        // Seed available actions
        const actions = await client.availableActions.createMany({
            data: [
                {
                    type: "Email",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "Solana",
                    image: "https://img.icons8.com/ios-filled/50/solana.png"
                },
                {
                    type: "Gmail Send Email",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "Gmail Reply",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "Gmail Add Label",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "Gmail Remove Label",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "Gmail Mark as Read",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "Gmail Archive",
                    image: "https://img.icons8.com/ios-filled/50/email.png"
                },
                {
                    type: "WhatsApp Send Message",
                    image: "https://img.icons8.com/color/48/whatsapp.png"
                },
                {
                    type: "Telegram Send Message",
                    image: "https://img.icons8.com/color/48/telegram-app.png"
                }
            ],
            skipDuplicates: true
        });

        console.log("Database seeded successfully!");
        console.log(`Created ${triggers.count} triggers and ${actions.count} actions`);
    } catch (error) {
        console.error("Error seeding database:", error);
    } finally {
        await client.$disconnect();
    }
}

seedDatabase();
