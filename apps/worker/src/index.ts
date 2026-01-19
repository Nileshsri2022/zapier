import express, { Request, Response } from "express";
import kafka from "@repo/kafka";
import client from "@repo/db";
import dotenv from "dotenv";
import { sendEmailWithTextBody } from "@repo/email";
import { withRetry, RetryResult } from "./utils/retry";
import { sendSol } from "./sendSolana";

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

// Execute action with retry
async function executeActionWithRetry(
    actionType: string,
    metadata: any,
    zapRunMetadata: any
): Promise<RetryResult<{ success: boolean; message: string }>> {
    return withRetry(async () => {
        if (actionType === "Email") {
            const { to, subject, body } = metadata;
            let emailReceiver: string;

            if (validateEmail(to)) {
                emailReceiver = to;
            } else {
                const searchKey = JSON.stringify(zapRunMetadata);
                emailReceiver = searchKey.slice(searchKey.indexOf("email") + 8, searchKey.indexOf(".com") + 4);
            }

            const emailBody = replaceKeys(body, zapRunMetadata);
            const result = await sendEmailWithTextBody(emailReceiver, subject, emailBody);

            // @ts-ignore - Handle both success and error response types
            if (result && result.error) {
                // @ts-ignore
                throw new Error(`Email send failed: ${result.error}`);
            }

            return { success: true, message: `Email sent to ${emailReceiver}` };
        }

        if (actionType === "Solana") {
            const { address, amount } = metadata;
            const resolvedAddress = replaceKeys(address, zapRunMetadata);
            const resolvedAmount = replaceKeys(amount, zapRunMetadata);

            // Check if SOL_PRIVATE_KEY is configured
            if (!process.env.SOL_PRIVATE_KEY) {
                console.warn("⚠️ SOL_PRIVATE_KEY not configured - skipping Solana transfer");
                return { success: false, message: "SOL_PRIVATE_KEY not configured" };
            }

            console.log(`Sending ${resolvedAmount} SOL to ${resolvedAddress}...`);
            await sendSol(resolvedAddress, resolvedAmount);
            console.log(`✅ SOL sent successfully to ${resolvedAddress}`);
            return { success: true, message: `${resolvedAmount} SOL sent to ${resolvedAddress}` };
        }

        if (actionType === "WhatsApp") {
            const { to, message, phoneNumberId, accessToken } = metadata;
            const resolvedTo = replaceKeys(to, zapRunMetadata);
            const resolvedMessage = replaceKeys(message, zapRunMetadata);

            // Dynamic imports for sendWhatsApp
            const { sendWhatsAppMessage } = await import("./sendWhatsApp");

            const result = await sendWhatsAppMessage(
                phoneNumberId,
                accessToken,
                resolvedTo,
                resolvedMessage
            );

            if (!result.success) {
                throw new Error(`WhatsApp send failed: ${result.error}`);
            }

            console.log(`✅ WhatsApp message sent to ${resolvedTo}`);
            return { success: true, message: `WhatsApp sent to ${resolvedTo}` };
        }

        if (actionType === "Telegram") {
            const { chatId, message, botToken } = metadata;
            const resolvedChatId = replaceKeys(chatId, zapRunMetadata);
            const resolvedMessage = replaceKeys(message, zapRunMetadata);

            // Dynamic imports for sendTelegram
            const { sendTelegramMessage } = await import("./sendTelegram");

            const result = await sendTelegramMessage(
                botToken,
                resolvedChatId,
                resolvedMessage
            );

            if (!result.success) {
                throw new Error(`Telegram send failed: ${result.error}`);
            }

            console.log(`✅ Telegram message sent to ${resolvedChatId}`);
            return { success: true, message: `Telegram sent to chat ${resolvedChatId}` };
        }

        return { success: true, message: `Unknown action: ${actionType}` };
    }, { maxRetries: 3, initialDelayMs: 1000 });
}

// Process a single Kafka message
async function processMessage(message: any) {
    const { zapRunId, stage } = JSON.parse(message.value.toString());
    const startTime = Date.now();

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
        return { success: false, reason: "action_not_found", duration: Date.now() - startTime };
    }

    // Execute action with retry
    const result = await executeActionWithRetry(
        currentAction.action.type,
        currentAction.metadata,
        zapRunDetails?.metadata
    );

    console.log(`Action ${currentAction.action.type}: ${result.success ? 'SUCCESS' : 'FAILED'} after ${result.attempts} attempt(s)`);

    // Queue next stage if not last and action succeeded
    if (result.success && stage !== lastStage) {
        console.log("Pushing next stage to kafka");
        await producer.send({
            topic: TOPIC_NAME,
            messages: [{
                value: JSON.stringify({ zapRunId, stage: stage + 1 })
            }]
        });
    }

    return {
        success: result.success,
        action: currentAction?.action?.type,
        attempts: result.attempts,
        duration: Date.now() - startTime,
        error: result.error?.message
    };
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
    console.log("📛 SIGTERM received, shutting down...");
    if (consumer) await consumer.disconnect();
    if (producer) await producer.disconnect();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`Worker service running on port ${PORT}`);
});