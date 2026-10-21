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

/**
 * Rate limiting.
 *
 * Two levels, because they answer two different questions:
 *
 * - **Per tenant** (`email:rate_limit:user:<id>`): is this account sending more
 *   than it should? Default 10/hour. One tenant hitting this must not affect
 *   anybody else — the old code used a single platform-wide key, so ten sends
 *   from one account silenced every other tenant's signup and failure mail
 *   for an hour (#57).
 * - **Platform** (`email:rate_limit:platform`): are *we* about to exceed the
 *   provider's quota? The provider limit is per API key, so this ceiling is
 *   much higher and derived from the configured Resend plan, not from 10/hour.
 */
const TENANT_RATE_LIMIT_PREFIX = 'email:rate_limit:user:';
const PLATFORM_RATE_LIMIT_KEY = 'email:rate_limit:platform';
/** Sends with no tenant identity (auth mail, failure notices) share one bucket. */
const ANONYMOUS_RATE_LIMIT_KEY = 'email:rate_limit:anonymous';

const MAX_EMAILS_PER_HOUR = parseInt(process.env.EMAIL_RATE_LIMIT_PER_HOUR || '10');
/** Resend free tier is 100/day; the ceiling defaults well under that. */
const MAX_PLATFORM_EMAILS_PER_HOUR = parseInt(
  process.env.EMAIL_PLATFORM_RATE_LIMIT_PER_HOUR || '90'
);
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

// Per-recipient cooldown (prevent one sender spamming the same person)
const RECIPIENT_COOLDOWN_SECONDS = parseInt(process.env.EMAIL_RECIPIENT_COOLDOWN || '300'); // 5 minutes default

/** Who is sending — scopes the tenant bucket and the recipient cooldown. */
export interface EmailScope {
  userId?: string | number;
  zapId?: string | number;
}

const tenantKey = (scope?: EmailScope): string => {
  const id = scope?.userId ?? scope?.zapId;
  return id === undefined || id === null || id === ''
    ? ANONYMOUS_RATE_LIMIT_KEY
    : `${TENANT_RATE_LIMIT_PREFIX}${id}`;
};

/**
 * Check if we're within rate limit
 * Returns true if OK to send, false if rate limited
 */
async function checkBucket(
  key: string,
  limit: number,
  label: string
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const current = (await redis.get(key)) as string | null;
  const count = current ? parseInt(current) : 0;
  const ttl = await redis.ttl(key);

  if (count >= limit) {
    console.warn(`⚠️ Email rate limit reached (${label}): ${count}/${limit} this hour`);
    return {
      allowed: false,
      remaining: 0,
      resetIn: ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS,
    };
  }

  return {
    allowed: true,
    remaining: limit - count - 1,
    resetIn: ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS,
  };
}

async function checkRateLimit(
  scope?: EmailScope
): Promise<{
  allowed: boolean;
  remaining: number;
  resetIn: number;
  reason?: 'TENANT' | 'PLATFORM';
}> {
  try {
    // Provider quota first: if the key itself is exhausted, no tenant may send.
    const platform = await checkBucket(
      PLATFORM_RATE_LIMIT_KEY,
      MAX_PLATFORM_EMAILS_PER_HOUR,
      'platform'
    );
    if (!platform.allowed) return { ...platform, reason: 'PLATFORM' };

    const tenant = await checkBucket(tenantKey(scope), MAX_EMAILS_PER_HOUR, 'tenant');
    if (!tenant.allowed) return { ...tenant, reason: 'TENANT' };

    return {
      allowed: true,
      remaining: Math.min(tenant.remaining, platform.remaining),
      resetIn: tenant.resetIn,
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
  email: string,
  scope?: EmailScope
): Promise<{ allowed: boolean; cooldownRemaining: number }> {
  try {
    const cooldownKey = cooldownKeyFor(email, scope);
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
/** Cooldown is per sender: two unrelated Zaps may notify one shared inbox. */
function cooldownKeyFor(email: string, scope?: EmailScope): string {
  const owner = scope?.userId ?? scope?.zapId;
  const who = owner === undefined || owner === null || owner === '' ? 'anonymous' : String(owner);
  return `email:cooldown:${who}:${email.toLowerCase()}`;
}

async function setRecipientCooldown(email: string, scope?: EmailScope): Promise<void> {
  try {
    const cooldownKey = cooldownKeyFor(email, scope);
    await redis.set(cooldownKey, '1', { ex: RECIPIENT_COOLDOWN_SECONDS });
  } catch (error) {
    console.error('Set recipient cooldown error:', error);
  }
}

/**
 * Increment rate limit counter
 */
async function incrementBucket(key: string): Promise<void> {
  const exists = await redis.exists(key);

  if (exists) {
    await redis.incr(key);
  } else {
    // First email in this window
    await redis.set(key, '1', { ex: RATE_LIMIT_WINDOW_SECONDS });
  }
}

async function incrementRateLimit(scope?: EmailScope): Promise<void> {
  try {
    await incrementBucket(tenantKey(scope));
    await incrementBucket(PLATFORM_RATE_LIMIT_KEY);
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
  templateData?: object,
  scope?: EmailScope
) => {
  try {
    // Check per-recipient cooldown first
    const cooldown = await checkRecipientCooldown(to, scope);
    if (!cooldown.allowed) {
      console.error(`❌ Email to ${to} blocked by cooldown. Wait ${cooldown.cooldownRemaining}s`);
      return { error: 'RECIPIENT_COOLDOWN', cooldownRemaining: cooldown.cooldownRemaining };
    }

    // Check this tenant's budget, then the provider ceiling
    const rateLimit = await checkRateLimit(scope);
    if (!rateLimit.allowed) {
      console.error(`❌ Email to ${to} blocked by rate limit. Reset in ${rateLimit.resetIn}s`);
      return { error: 'RATE_LIMITED', reason: rateLimit.reason, resetIn: rateLimit.resetIn };
    }

    const relativePath = '/templates/' + templateName;
    const templatePath = __dirname + relativePath;

    // Check if template exists. Returning `undefined` here used to look like
    // success to every caller, so a template rename silently stopped mail
    // with no signal (#57).
    if (!fs.existsSync(templatePath)) {
      console.error(`Template not found: ${templatePath}`);
      return { error: 'TEMPLATE_NOT_FOUND', template: templateName };
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
      return { error: error.message || 'RESEND_ERROR' };
    }

    // Increment rate limit and set cooldown on success
    await incrementRateLimit(scope);
    await setRecipientCooldown(to, scope);

    console.log(
      `✅ Email sent successfully: ${data?.id} (${rateLimit.remaining} remaining this hour)`
    );
    return data;
  } catch (error) {
    console.error('Email service error:', error);
    return { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' };
  }
};

/**
 * Send email with plain text body (for Zap actions)
 */
export const sendEmailWithTextBody = async (
  to: string,
  subject: string,
  body: string,
  scope?: EmailScope
) => {
  console.log('📧 [Email Package] sendEmailWithTextBody called:');
  console.log('  - To:', to);
  console.log('  - Subject:', subject);
  console.log('  - Body length:', body?.length || 0);
  console.log('  - From:', fromEmail);
  console.log('  - RESEND_API_KEY exists:', !!process.env.RESEND_API_KEY);

  try {
    // Check per-recipient cooldown first
    const cooldown = await checkRecipientCooldown(to, scope);
    if (!cooldown.allowed) {
      console.error(`❌ Email to ${to} blocked by cooldown. Wait ${cooldown.cooldownRemaining}s`);
      return { error: 'RECIPIENT_COOLDOWN', cooldownRemaining: cooldown.cooldownRemaining };
    }

    // Check this tenant's budget, then the provider ceiling
    const rateLimit = await checkRateLimit(scope);
    if (!rateLimit.allowed) {
      console.error(`❌ Email to ${to} blocked by rate limit. Reset in ${rateLimit.resetIn}s`);
      return { error: 'RATE_LIMITED', reason: rateLimit.reason, resetIn: rateLimit.resetIn };
    }

    console.log('📧 [Email Package] Calling Resend API...');
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      subject,
      text: body,
    });

    console.log('📧 [Email Package] Resend API response:');
    console.log('  - Data:', JSON.stringify(data));
    console.log('  - Error:', JSON.stringify(error));

    if (error) {
      console.error('Email send error:', error);
      return { error: error.message || 'Unknown Resend error' };
    }

    // Increment rate limit and set cooldown on success
    await incrementRateLimit(scope);
    await setRecipientCooldown(to, scope);

    console.log(
      `✅ Email sent successfully: ${data?.id} (${rateLimit.remaining} remaining this hour)`
    );
    return data;
  } catch (error) {
    console.error('Email service error:', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
};

/**
 * Send email with HTML body (for custom HTML)
 */
export const sendEmailWithHtmlBody = async (
  to: string,
  subject: string,
  html: string,
  scope?: EmailScope
) => {
  try {
    // Check per-recipient cooldown first
    const cooldown = await checkRecipientCooldown(to, scope);
    if (!cooldown.allowed) {
      console.error(`❌ Email to ${to} blocked by cooldown. Wait ${cooldown.cooldownRemaining}s`);
      return { error: 'RECIPIENT_COOLDOWN', cooldownRemaining: cooldown.cooldownRemaining };
    }

    // Check this tenant's budget, then the provider ceiling
    const rateLimit = await checkRateLimit(scope);
    if (!rateLimit.allowed) {
      console.error(`❌ Email to ${to} blocked by rate limit. Reset in ${rateLimit.resetIn}s`);
      return { error: 'RATE_LIMITED', reason: rateLimit.reason, resetIn: rateLimit.resetIn };
    }

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      subject,
      html,
    });

    if (error) {
      console.error('Email send error:', error);
      return { error: error.message || 'RESEND_ERROR' };
    }

    // Increment rate limit and set cooldown on success
    await incrementRateLimit(scope);
    await setRecipientCooldown(to, scope);

    console.log(
      `✅ Email sent successfully: ${data?.id} (${rateLimit.remaining} remaining this hour)`
    );
    return data;
  } catch (error) {
    console.error('Email service error:', error);
    return { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' };
  }
};

/**
 * Get current rate limit status
 */
export const getRateLimitStatus = async (scope?: EmailScope) => {
  return checkRateLimit(scope);
};

/**
 * Send notification when a Zap run fails
 */
export const sendZapFailureNotification = async (
  userEmail: string,
  zapName: string,
  zapId: string,
  errorMessage: string,
  runId: string
) => {
  try {
    const dashboardUrl = process.env.FRONTEND_URL || 'https://zapmate.vercel.app';
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    return await sendEmail(
      userEmail,
      `⚠️ Your Zap "${zapName}" Failed`,
      'zap-failure-notification.html',
      {
        zapName,
        zapId,
        errorMessage: errorMessage || 'Unknown error occurred',
        runId,
        dashboardUrl,
        timestamp,
      },
      // Own bucket: failure notices must not compete with the tenant's sends
      // (or with signup mail) for the same 10/hour allowance.
      { zapId }
    );
  } catch (error) {
    console.error('Failed to send Zap failure notification:', error);
    // Don't throw - notification failure shouldn't break the worker
    return null;
  }
};
