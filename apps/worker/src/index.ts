import express, { Request, Response } from "express";
import kafka from "@repo/kafka";
import client from "@repo/db";
import dotenv from "dotenv";
import { sendEmailWithTextBody } from "@repo/email";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;
const TOPIC_NAME = "zap-events";

let consumer: any = null;
let producer: any = null;

const validateEmail = (email: string) => {
    const regex = /^\S+@\S+\.\S+$/;
    return regex.test(email);
};

function replaceKeys(template: string, replacements: Record<string, string>): string {
    return template.replace(/{(.*?)}/g, (_, key) => {
        return replacements[key] || `{${key}}`;
    });
}

// Initialize Kafka
async function initKafka() {
    if (!consumer) {
        consumer = kafka.consumer({ groupId: "worker" });
        await consumer.connect();
        await consumer.subscribe({ topic: TOPIC_NAME, fromBeginning: false });
        console.log("Kafka consumer connected");
    }
    if (!producer) {
        producer = kafka.producer();
        await producer.connect();
        console.log("Kafka producer connected");
    }
}

// Process a single Kafka message
async function processMessage(message: any) {
    const { zapRunId, stage } = JSON.parse(message.value.toString());

    const zapRunDetails = await client.zapRun.findFirst({
        where: { id: zapRunId },
        include: {
            zap: {
                include: {
                    actions: {
                        include: { action: true }
                    }
                }
            }
        }
    });

    const lastStage = zapRunDetails?.zap?.actions?.length || 1;
    const currentAction = zapRunDetails?.zap?.actions?.find((a: any) => a.sortingOrder === stage);

    if (!currentAction) {
        console.log("Current Action not found");
        return { success: false, reason: "action_not_found" };
    }

    // Send Email Logic
    if (currentAction?.action?.type === "Email") {
        console.log("Sending Email");
        // @ts-ignore
        const { to, subject, body } = currentAction.metadata;
        let emailReceiver: string;

        if (validateEmail(to)) {
            emailReceiver = to;
        } else {
            const searchKey = JSON.stringify(zapRunDetails?.metadata);
            emailReceiver = searchKey.slice(searchKey.indexOf("email") + 8, searchKey.indexOf(".com") + 4);
        }

        // @ts-ignore
        const emailBody = replaceKeys(body, zapRunDetails?.metadata);
        await sendEmailWithTextBody(emailReceiver, subject, emailBody);
    }

    // Send Solana Logic
    if (currentAction?.action?.type === "Solana") {
        // @ts-ignore
        const { address, amount } = currentAction.metadata;
        // @ts-ignore
        console.log(`Send sol to ${replaceKeys(address, zapRunDetails?.metadata)} of amount: ${replaceKeys(amount, zapRunDetails?.metadata)}`);
    }

    // Queue next stage if not last
    if (stage !== lastStage) {
        console.log("Pushing back to kafka");
        await producer.send({
            topic: TOPIC_NAME,
            messages: [{
                value: JSON.stringify({ zapRunId, stage: stage + 1 })
            }]
        });
    }

    return { success: true, action: currentAction?.action?.type };
}

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
    res.json({ status: "ok", service: "worker" });
});

// Process messages - triggered by cron
app.post("/process", async (req: Request, res: Response): Promise<any> => {
    try {
        const authHeader = req.headers.authorization;
        const cronSecret = process.env.CRON_SECRET;

        // Verify cron secret if configured
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        await initKafka();

        let processedCount = 0;
        const maxMessages = 20; // Process up to 20 messages per cron trigger
        const results: any[] = [];

        // Run consumer for a batch
        await consumer.run({
            autoCommit: false,
            eachMessage: async ({ topic, partition, message }: any) => {
                if (processedCount >= maxMessages) return;

                try {
                    const result = await processMessage(message);
                    results.push(result);
                    processedCount++;

                    await consumer.commitOffsets([{
                        topic,
                        partition,
                        offset: (parseInt(message.offset) + 1).toString()
                    }]);
                } catch (error) {
                    console.error("Message processing error:", error);
                    results.push({ success: false, error: String(error) });
                }
            }
        });

        // Wait a bit to allow message processing
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Pause consumer after batch
        await consumer.pause([{ topic: TOPIC_NAME }]);

        return res.json({
            message: "Processing complete",
            processed: processedCount,
            results
        });

    } catch (error) {
        console.error("Worker error:", error);
        return res.status(500).json({
            error: "Processing failed",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down...");
    if (consumer) await consumer.disconnect();
    if (producer) await producer.disconnect();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`Worker service running on port ${PORT}`);
});