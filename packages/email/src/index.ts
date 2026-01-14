import { Resend } from "resend";
import fs from "fs";
import handlebars from "handlebars";
import dotenv from "dotenv";

dotenv.config({ path: __dirname + "/../.env" });

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);
const fromEmail = process.env.SENDER_EMAIL || "onboarding@resend.dev";

/**
 * Send email with HTML template
 */
export const sendEmail = async (to: string, subject: string, templateName: string, templateData?: object) => {
    try {
        const relativePath = "/templates/" + templateName;
        const templatePath = __dirname + relativePath;

        // Check if template exists
        if (!fs.existsSync(templatePath)) {
            console.error(`Template not found: ${templatePath}`);
            return;
        }

        const template = fs.readFileSync(templatePath, "utf-8");
        const compiledTemplate = handlebars.compile(template);
        const htmlContent = compiledTemplate(templateData || {});

        const { data, error } = await resend.emails.send({
            from: fromEmail,
            to: [to],
            subject,
            html: htmlContent
        });

        if (error) {
            console.error("Email send error:", error);
            return;
        }

        console.log(`✅ Email sent successfully: ${data?.id}`);
        return data;
    } catch (error) {
        console.error("Email service error:", error);
    }
};

/**
 * Send email with plain text body (for Zap actions)
 */
export const sendEmailWithTextBody = async (to: string, subject: string, body: string) => {
    try {
        const { data, error } = await resend.emails.send({
            from: fromEmail,
            to: [to],
            subject,
            text: body
        });

        if (error) {
            console.error("Email send error:", error);
            return;
        }

        console.log(`✅ Email sent successfully: ${data?.id}`);
        return data;
    } catch (error) {
        console.error("Email service error:", error);
    }
};

/**
 * Send email with HTML body (for custom HTML)
 */
export const sendEmailWithHtmlBody = async (to: string, subject: string, html: string) => {
    try {
        const { data, error } = await resend.emails.send({
            from: fromEmail,
            to: [to],
            subject,
            html
        });

        if (error) {
            console.error("Email send error:", error);
            return;
        }

        console.log(`✅ Email sent successfully: ${data?.id}`);
        return data;
    } catch (error) {
        console.error("Email service error:", error);
    }
};
