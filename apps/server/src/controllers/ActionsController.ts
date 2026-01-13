import client from "@repo/db";
import type { Response, Request } from "express";
import nodemailer from "nodemailer";
import axios from "axios";
import { executeGmailAction } from "./GmailActionsController";

export const fetchAvailableActions = async (req: Request, res: Response):Promise<any> => {
    const availableActions = await client.availableActions.findMany();

    return res.status(200).json({
        message: "Fetched available actions",
        availableActions
    })
}

export const executeAction = async (actionType: string, metadata: any, triggerPayload: any) => {
    switch (actionType) {
        case 'Email':
            return await executeEmailAction(metadata, triggerPayload);
        case 'Solana':
            return await executeSolanaAction(metadata, triggerPayload);
        case 'GmailSend':
        case 'GmailReply':
        case 'GmailAddLabel':
        case 'GmailRemoveLabel':
        case 'GmailMarkRead':
        case 'GmailArchive':
            return await executeGmailAction(actionType, metadata, triggerPayload);
        default:
            throw new Error(`Unsupported action type: ${actionType}`);
    }
};

const executeEmailAction = async (metadata: any, triggerPayload: any) => {
    try {
        const { to, subject, body } = metadata;

        // Create transporter
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        // Replace placeholders in email content
        const processedSubject = replacePlaceholders(subject, triggerPayload);
        const processedBody = replacePlaceholders(body, triggerPayload);
        const processedTo = replacePlaceholders(to, triggerPayload);

        const mailOptions = {
            from: process.env.SMTP_USER || 'zapmate@example.com',
            to: processedTo,
            subject: processedSubject,
            html: processedBody
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully to ${processedTo}`);
    } catch (error) {
        console.error('Email action failed:', error);
        throw error;
    }
};

const executeSolanaAction = async (metadata: any, triggerPayload: any) => {
    try {
        const { address, amount } = metadata;

        // This is a placeholder for Solana transaction logic
        // In a real implementation, you'd use @solana/web3.js
        console.log(`Solana transaction: sending ${amount} to ${address}`);
        console.log('Trigger payload:', triggerPayload);

        // Placeholder for actual Solana transaction
        // const connection = new Connection('https://api.mainnet-beta.solana.com');
        // const transaction = new Transaction();
        // ... implement actual Solana logic

        console.log(`Solana action executed successfully for address ${address}`);
    } catch (error) {
        console.error('Solana action failed:', error);
        throw error;
    }
};

const replacePlaceholders = (template: string, data: any): string => {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return data[key] !== undefined ? String(data[key]) : match;
    });
};
