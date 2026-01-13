import { z } from "zod";

// Environment variable schema
const envSchema = z.object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    JWT_SECRET: z.string().min(10, "JWT_SECRET must be at least 10 characters"),
    PORT: z.string().default("5000"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // Optional SMTP settings
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    // Optional webhook secret
    WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// Validate environment variables on startup
export function validateEnv(): Env {
    try {
        const env = envSchema.parse(process.env);
        console.log("✅ Environment variables validated successfully");
        return env;
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error("❌ Environment validation failed:");
            error.issues.forEach((issue) => {
                console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
            });
            process.exit(1);
        }
        throw error;
    }
}

// Export validated env
export const env = validateEnv();
