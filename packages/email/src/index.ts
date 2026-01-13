import nodemailer from "nodemailer";
import fs from "fs";
import handlebars from "handlebars";
import _ from "lodash";
import dotenv from "dotenv";

dotenv.config({path: __dirname + "/../.env"});
const transporter = nodemailer.createTransport({
    service: "gmail",
    host: process.env.SMTP_HOST,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
    }
})

export const sendEmail = async (to: string, subject: string, body: string, user?: string) => {
    const relativePath = "/templates/" + body;
    const template = fs.readFileSync(__dirname + relativePath, "utf-8").toString()
    const html = handlebars.compile(template);
    const htmlContent = html(user || "");

    try {
        await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to,
            subject,
            html: htmlContent
        })
    } catch(error) {
        console.log(error);
    }
}

export const sendEmailWithTextBody = async (to: string, subject: string, body: string) => {
    try {
        await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to,
            subject,
            text: body
        })
    } catch(error) {
        console.log(error)
    }
}
