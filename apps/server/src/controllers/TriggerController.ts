import client from "@repo/db";
import type { Request, Response } from "express";
import crypto from "crypto";
import { processWebhookTrigger, processGmailTrigger } from "./ZapController";

export const fetchAvailableTriggers = async (req: Request, res: Response): Promise<any> => {
    const avialableTriggers = await client.availableTriggers.findMany();

    return res.status(200).json({
        message: "Fetched available triggers",
        avialableTriggers
    })
}

export const handleWebhook = async (req: Request, res: Response): Promise<any> => {
    try {
        const { zapId } = req.params;
        const payload = req.body;
        const signature = req.headers['x-webhook-signature'] as string;

        if (!zapId) {
            return res.status(400).json({ message: "Zap ID is required" });
        }

        // Verify webhook signature if provided
        if (signature) {
            const isValidSignature = verifyWebhookSignature(JSON.stringify(payload), signature);
            if (!isValidSignature) {
                return res.status(401).json({ message: "Invalid webhook signature" });
            }
        }

        // Process the webhook trigger
        await processWebhookTrigger(zapId as string, payload);

        return res.status(200).json({
            message: "Webhook processed successfully",
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("Webhook processing error:", error);
        return res.status(500).json({
            message: "Webhook processing failed",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
};

export const handleGmailTrigger = async (req: Request, res: Response): Promise<any> => {
    try {
        const { zapId } = req.params;
        const emailData = req.body;

        if (!zapId) {
            return res.status(400).json({ message: "Zap ID is required" });
        }

        // Process the Gmail trigger
        await processGmailTrigger(zapId as string, emailData);

        return res.status(200).json({
            message: "Gmail trigger processed successfully",
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("Gmail trigger processing error:", error);
        return res.status(500).json({
            message: "Gmail trigger processing failed",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
};

export const verifyWebhookSignature = (payload: string, signature: string): boolean => {
    try {
        // In a real implementation, you'd use a proper webhook secret
        // For now, we'll do a basic verification
        const expectedSignature = crypto
            .createHmac('sha256', process.env.WEBHOOK_SECRET || 'default-secret')
            .update(payload)
            .digest('hex');

        return signature === `sha256=${expectedSignature}`;
    } catch (error) {
        console.error("Signature verification error:", error);
        return false;
    }
};
