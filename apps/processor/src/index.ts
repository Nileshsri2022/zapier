import express, { Request, Response } from "express";
import kafka from "@repo/kafka";
import client from "@repo/db";

const app = express();
const PORT = process.env.PORT || 3001;

let producer: any = null;

// Initialize Kafka producer
async function initKafka() {
    if (!producer) {
        producer = kafka.producer();
        await producer.connect();
        console.log("Kafka producer connected");
    }
    return producer;
}

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
    res.json({ status: "ok", service: "processor" });
});

// Process outbox - triggered by cron
app.post("/process", async (req: Request, res: Response): Promise<any> => {
    try {
        const authHeader = req.headers.authorization;
        const cronSecret = process.env.CRON_SECRET;

        // Verify cron secret if configured
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        await initKafka();

        // Find pending outbox entries
        const pendingRows = await client.zapRunOutbox.findMany({
            where: {
                zapRun: {
                    zap: {
                        isActive: true
                    }
                }
            },
            take: 50 // Process up to 50 per cron trigger
        });

        if (pendingRows.length === 0) {
            return res.json({
                message: "No pending items",
                processed: 0
            });
        }

        // Send to Kafka
        await producer.send({
            topic: "zap-events",
            messages: pendingRows.map((r: any) => ({
                value: JSON.stringify({ zapRunId: r.zapRunId, stage: 1 })
            }))
        });

        // Delete processed entries
        await client.zapRunOutbox.deleteMany({
            where: {
                id: {
                    in: pendingRows.map((r: any) => r.id)
                }
            }
        });

        console.log(`Processed ${pendingRows.length} outbox entries`);

        return res.json({
            message: "Processing complete",
            processed: pendingRows.length
        });

    } catch (error) {
        console.error("Processing error:", error);
        return res.status(500).json({
            error: "Processing failed",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down...");
    if (producer) {
        await producer.disconnect();
    }
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`Processor service running on port ${PORT}`);
});