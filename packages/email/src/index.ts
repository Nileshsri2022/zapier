import { Resend } from 'resend';
import fs from 'fs';
import handlebars from 'handlebars';
import dotenv from 'dotenv';
// @ts-ignore - Redis module will be available after build
import redis from '@repo/redis';

dotenv.config({ path: __dirname + '/../.env' });

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);
const fromEmail = process.env.SENDER_EMAIL || 'ZapMate <noreply@meradomain.qzz.io>';

// Rate limiting config (Resend free tier: 100/day, ~4/hour safe limit)
const RATE_LIMIT_KEY = 'email:rate_limit';
const MAX_EMAILS_PER_HOUR = parseInt(process.env.EMAIL_RATE_LIMIT_PER_HOUR || '10');
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

// Per-recipient cooldown (prevent spamming same person)
const RECIPIENT_COOLDOWN_SECONDS = parseInt(process.env.EMAIL_RECIPIENT_COOLDOWN || '300'); // 5 minutes default

/**
 * Check if we're within rate limit
 * Returns true if OK to send, false if rate limited
 */
async function checkRateLimit(): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  try {
    const current = (await redis.get(RATE_LIMIT_KEY)) as string | null;
    const count = current ? parseInt(current) : 0;
    const ttl = await redis.ttl(RATE_LIMIT_KEY);

    if (count >= MAX_EMAILS_PER_HOUR) {
      console.warn(`⚠️ Email rate limit reached: ${count}/${MAX_EMAILS_PER_HOUR} emails this hour`);
      return {
        allowed: false,
        remaining: 0,
        resetIn: ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS,
      };
    }

    return {
      allowed: true,
      remaining: MAX_EMAILS_PER_HOUR - count - 1,
      resetIn: ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS,
    };
  } catch (error) {
    console.error('Rate limit check error:', error);
    // Allow sending on Redis error to avoid blocking all emails
    return { allowed: true, remaining: -1, resetIn: 0 };
  }
}

/**
 * Check per-recipient cooldown
 * Prevents sending multiple emails to the same address in quick succession
 */
async function checkRecipientCooldown(
  email: string
): Promise<{ allowed: boolean; cooldownRemaining: number }> {
  try {
    const cooldownKey = `email:cooldown:${email.toLowerCase()}`;
    const ttl = await redis.ttl(cooldownKey);

    if (ttl > 0) {
      console.warn(`⚠️ Recipient ${email} is on cooldown for ${ttl}s`);
      return { allowed: false, cooldownRemaining: ttl };
    }

    return { allowed: true, cooldownRemaining: 0 };
  } catch (error) {
    console.error('Recipient cooldown check error:', error);
    return { allowed: true, cooldownRemaining: 0 };
  }
}

/**
 * Set recipient cooldown after sending
 */
async function setRecipientCooldown(email: string): Promise<void> {
  try {
    const cooldownKey = `email:cooldown:${email.toLowerCase()}`;
    await redis.set(cooldownKey, '1', { ex: RECIPIENT_COOLDOWN_SECONDS });
  } catch (error) {
    console.error('Set recipient cooldown error:', error);
  }
}

/**
 * Increment rate limit counter
 */
async function incrementRateLimit(): Promise<void> {
  try {
    const exists = await redis.exists(RATE_LIMIT_KEY);

    if (exists) {
      await redis.incr(RATE_LIMIT_KEY);
    } else {
      // First email in this window
      await redis.set(RATE_LIMIT_KEY, '1', { ex: RATE_LIMIT_WINDOW_SECONDS });
    }
  } catch (error) {
    console.error('Rate limit increment error:', error);
  }
}

/**
 * Send email with HTML template
 */
export const sendEmail = async (
  to: string,
  subject: string,
  templateName: string,
  templateData?: object
) => {
  try {
    // Check per-recipient cooldown first
    const cooldown = await checkRecipientCooldown(to);
    if (!cooldown.allowed) {
      console.error(`❌ Email to ${to} blocked by cooldown. Wait ${cooldown.cooldownRemaining}s`);
      return { error: 'RECIPIENT_COOLDOWN', cooldownRemaining: cooldown.cooldownRemaining };
    }

    // Check global rate limit
    const rateLimit = await checkRateLimit();
    if (!rateLimit.allowed) {
      console.error(`❌ Email to ${to} blocked by rate limit. Reset in ${rateLimit.resetIn}s`);
      return { error: 'RATE_LIMITED', resetIn: rateLimit.resetIn };
    }

    const relativePath = '/templates/' + templateName;
    const templatePath = __dirname + relativePath;

    // Check if template exists
    if (!fs.existsSync(templatePath)) {
      console.error(`Template not found: ${templatePath}`);
      return;
    }

    const template = fs.readFileSync(templatePath, 'utf-8');
    const compiledTemplate = handlebars.compile(template);
    const htmlContent = compiledTemplate(templateData || {});

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      subject,
      html: htmlContent,
    });

    if (error) {
      console.error('Email send error:', error);
      return;
    }

    // Increment rate limit and set cooldown on success
    await incrementRateLimit();
    await setRecipientCooldown(to);

    console.log(
      `✅ Email sent successfully: ${data?.id} (${rateLimit.remaining} remaining this hour)`
    );
    return data;
  } catch (error) {
    console.error('Email service error:', error);
  }
};

/**
 * Send email with plain text body (for Zap actions)
 */
export const sendEmailWithTextBody = async (to: string, subject: string, body: string) => {
  try {
    // Check per-recipient cooldown first
    const cooldown = await checkRecipientCooldown(to);
    if (!cooldown.allowed) {
      console.error(`❌ Email to ${to} blocked by cooldown. Wait ${cooldown.cooldownRemaining}s`);
      return { error: 'RECIPIENT_COOLDOWN', cooldownRemaining: cooldown.cooldownRemaining };
    }

    // Check global rate limit
    const rateLimit = await checkRateLimit();
    if (!rateLimit.allowed) {
      console.error(`❌ Email to ${to} blocked by rate limit. Reset in ${rateLimit.resetIn}s`);
      return { error: 'RATE_LIMITED', resetIn: rateLimit.resetIn };
    }

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      subject,
      text: body,
    });

    if (error) {
      console.error('Email send error:', error);
      return;
    }

    // Increment rate limit and set cooldown on success
    await incrementRateLimit();
    await setRecipientCooldown(to);

    console.log(
      `✅ Email sent successfully: ${data?.id} (${rateLimit.remaining} remaining this hour)`
    );
    return data;
  } catch (error) {
    console.error('Email service error:', error);
  }
};

/**
 * Send email with HTML body (for custom HTML)
 */
export const sendEmailWithHtmlBody = async (to: string, subject: string, html: string) => {
  try {
    // Check per-recipient cooldown first
    const cooldown = await checkRecipientCooldown(to);
    if (!cooldown.allowed) {
      console.error(`❌ Email to ${to} blocked by cooldown. Wait ${cooldown.cooldownRemaining}s`);
      return { error: 'RECIPIENT_COOLDOWN', cooldownRemaining: cooldown.cooldownRemaining };
    }

    // Check global rate limit
    const rateLimit = await checkRateLimit();
    if (!rateLimit.allowed) {
      console.error(`❌ Email to ${to} blocked by rate limit. Reset in ${rateLimit.resetIn}s`);
      return { error: 'RATE_LIMITED', resetIn: rateLimit.resetIn };
    }

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      subject,
      html,
    });

    if (error) {
      console.error('Email send error:', error);
      return;
    }

    // Increment rate limit and set cooldown on success
    await incrementRateLimit();
    await setRecipientCooldown(to);

    console.log(
      `✅ Email sent successfully: ${data?.id} (${rateLimit.remaining} remaining this hour)`
    );
    return data;
  } catch (error) {
    console.error('Email service error:', error);
  }
};

/**
 * Get current rate limit status
 */
export const getRateLimitStatus = async () => {
  return checkRateLimit();
};
