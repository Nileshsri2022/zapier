import { Router, Request, Response } from "express";
import crypto from "crypto";
import client from "@repo/db";

const router = Router();

// Verify GitHub webhook signature
function verifyGitHubSignature(payload: string, signature: string | undefined, secret: string): boolean {
    if (!signature) return false;

    const expectedSignature = `sha256=${crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex")}`;

    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    } catch {
        return false;
    }
}

// Parse GitHub event type to trigger type
function getGitHubTriggerType(event: string): string | null {
    const eventMap: Record<string, string> = {
        "push": "GitHub Push",
        "pull_request": "GitHub Pull Request",
        "issues": "GitHub Issue",
        "release": "GitHub Release"
    };
    return eventMap[event] || null;
}

// Extract relevant data from GitHub payload
function extractPayloadData(event: string, payload: any): Record<string, any> {
    const baseData = {
        event,
        repository: {
            name: payload.repository?.name || "",
            full_name: payload.repository?.full_name || "",
            url: payload.repository?.html_url || ""
        },
        sender: {
            login: payload.sender?.login || "",
            url: payload.sender?.html_url || ""
        }
    };

    switch (event) {
        case "push":
            return {
                ...baseData,
                ref: payload.ref || "",
                branch: payload.ref?.replace("refs/heads/", "") || "",
                commits: payload.commits?.length || 0,
                head_commit: {
                    message: payload.head_commit?.message || "",
                    author: payload.head_commit?.author?.name || "",
                    url: payload.head_commit?.url || ""
                },
                pusher: {
                    name: payload.pusher?.name || "",
                    email: payload.pusher?.email || ""
                }
            };

        case "pull_request":
            return {
                ...baseData,
                action: payload.action || "",
                pull_request: {
                    title: payload.pull_request?.title || "",
                    number: payload.pull_request?.number || 0,
                    state: payload.pull_request?.state || "",
                    url: payload.pull_request?.html_url || "",
                    body: payload.pull_request?.body || "",
                    user: payload.pull_request?.user?.login || ""
                }
            };

        case "issues":
            return {
                ...baseData,
                action: payload.action || "",
                issue: {
                    title: payload.issue?.title || "",
                    number: payload.issue?.number || 0,
                    state: payload.issue?.state || "",
                    url: payload.issue?.html_url || "",
                    body: payload.issue?.body || "",
                    user: payload.issue?.user?.login || ""
                }
            };

        case "release":
            return {
                ...baseData,
                action: payload.action || "",
                release: {
                    tag_name: payload.release?.tag_name || "",
                    name: payload.release?.name || "",
                    body: payload.release?.body || "",
                    url: payload.release?.html_url || "",
                    prerelease: payload.release?.prerelease || false
                }
            };

        default:
            return baseData;
    }
}

// Handle GitHub webhook
router.post("/webhook/:zapId", async (req: Request, res: Response): Promise<any> => {
    try {
        const zapId = req.params.zapId as string;
        const eventHeader = req.headers["x-github-event"];
        const event: string = Array.isArray(eventHeader)
            ? eventHeader[0] ?? ""
            : eventHeader ?? "";
        const sigHeader = req.headers["x-hub-signature-256"];
        const signature: string | undefined = Array.isArray(sigHeader)
            ? sigHeader[0]
            : sigHeader;
        const secret = process.env.GITHUB_WEBHOOK_SECRET;

        console.log(`📦 GitHub webhook received: ${event} for zap ${zapId}`);

        // Validate event type
        const triggerType = getGitHubTriggerType(event);
        if (!triggerType) {
            console.log(`⚠️ Unsupported GitHub event: ${event}`);
            return res.status(200).json({ message: "Event type not supported", event });
        }

        // Verify signature if secret is configured
        if (secret && signature) {
            const rawBody = JSON.stringify(req.body);
            if (!verifyGitHubSignature(rawBody, signature, secret)) {
                console.log(`❌ Invalid GitHub signature for zap ${zapId}`);
                return res.status(401).json({ error: "Invalid signature" });
            }
        }

        // Find the zap
        const zap = await client.zap.findUnique({
            where: { id: zapId }
        });

        if (!zap) {
            return res.status(404).json({ error: "Zap not found" });
        }

        if (!zap.isActive) {
            return res.status(200).json({ message: "Zap is not active" });
        }

        // Get the trigger type from the database using triggerId
        const trigger = await client.trigger.findUnique({
            where: { zapId: zap.id }
        });

        let zapTriggerType: string | null = null;
        if (trigger) {
            const availableTrigger = await client.availableTriggers.findUnique({
                where: { id: trigger.triggerId }
            });
            zapTriggerType = availableTrigger?.type || null;
        }

        // Verify trigger type matches
        if (zapTriggerType !== triggerType) {
            console.log(`⚠️ Trigger mismatch: expected ${zapTriggerType}, got ${triggerType}`);
            return res.status(200).json({
                message: "Event type does not match zap trigger",
                expected: zapTriggerType,
                received: triggerType
            });
        }

        // Extract payload data
        const payloadData = extractPayloadData(event || "", req.body);

        // Create ZapRun
        const zapRun = await client.zapRun.create({
            data: {
                zapId: zap.id,
                metadata: payloadData
            }
        });

        console.log(`✅ ZapRun created: ${zapRun.id} for ${triggerType}`);

        // Add to outbox for processing
        await client.zapRunOutbox.create({
            data: {
                zapRunId: zapRun.id
            }
        });

        return res.status(200).json({
            message: "GitHub webhook processed",
            zapRunId: zapRun.id,
            event: triggerType
        });

    } catch (error) {
        console.error("❌ GitHub webhook error:", error);
        return res.status(500).json({
            error: "Internal server error",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Health check for GitHub webhooks
router.get("/health", (req: Request, res: Response) => {
    res.json({ status: "ok", service: "github-webhooks" });
});

export default router;
