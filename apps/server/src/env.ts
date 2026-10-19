import { z } from 'zod';
import { readAiPolicy } from '@repo/ai';
import { validateAiConnectionEnvironment } from './services/aiConnections';

// Environment variable schema
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(10, 'JWT_SECRET must be at least 10 characters'),
  PORT: z.string().default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // No SMTP block: the server-inline nodemailer Email executor was deleted
  // in gmail-worker-routing-spec P5. The Email action sends from
  // apps/worker via Resend (RESEND_API_KEY there); this server never sends
  // action email. Setting SMTP_* has no effect.

  // Optional webhook secret
  WEBHOOK_SECRET: z.string().optional(),

  // Gmail Pub/Sub push OIDC verification (spec §4.4). Both are optional in
  // schema but SHOULD be set in production: the audience expected on the
  // push JWT and the service-account email allowed to deliver to us.
  GMAIL_PUBSUB_AUDIENCE: z.string().optional(),
  GMAIL_PUBSUB_SERVICE_ACCOUNT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// Validate environment variables on startup
export function validateEnv(): Env {
  try {
    const env = envSchema.parse(process.env);
    validateAiConnectionEnvironment();
    readAiPolicy();
    console.log('✅ Environment variables validated successfully');
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:');
      error.issues.forEach((issue) => {
        console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

// Export validated env
export const env = validateEnv();
