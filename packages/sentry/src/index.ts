import * as Sentry from '@sentry/node';

export interface SentryConfig {
    dsn?: string;
    environment?: string;
    serviceName: string;
    release?: string;
    sampleRate?: number;
}

let isInitialized = false;

/**
 * Initialize Sentry for the service
 */
export function initSentry(config: SentryConfig): void {
    const dsn = config.dsn || process.env.SENTRY_DSN;

    if (!dsn) {
        console.warn('⚠️ Sentry DSN not provided. Error tracking disabled.');
        return;
    }

    if (isInitialized) {
        console.warn('⚠️ Sentry already initialized');
        return;
    }

    Sentry.init({
        dsn,
        environment: config.environment || process.env.NODE_ENV || 'development',
        release: config.release || process.env.RELEASE_VERSION,
        tracesSampleRate: config.sampleRate || 0.1,
        beforeSend(event) {
            event.tags = {
                ...event.tags,
                service: config.serviceName,
            };
            return event;
        },
    });

    isInitialized = true;
    console.log(`✅ Sentry initialized for ${config.serviceName}`);
}

/**
 * Capture an exception
 */
export function captureException(error: Error, context?: Record<string, unknown>): string {
    if (!isInitialized) {
        console.error('Sentry not initialized:', error.message);
        return '';
    }

    return Sentry.captureException(error, {
        extra: context,
    });
}

/**
 * Capture a message
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): string {
    if (!isInitialized) {
        console.log(`[${level}] ${message}`);
        return '';
    }

    return Sentry.captureMessage(message, level);
}

/**
 * Set user context
 */
export function setUser(user: { id: string; email?: string; username?: string }): void {
    if (!isInitialized) return;
    Sentry.setUser(user);
}

/**
 * Clear user context
 */
export function clearUser(): void {
    if (!isInitialized) return;
    Sentry.setUser(null);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(breadcrumb: {
    category: string;
    message: string;
    level?: 'debug' | 'info' | 'warning' | 'error';
    data?: Record<string, unknown>;
}): void {
    if (!isInitialized) return;
    Sentry.addBreadcrumb(breadcrumb);
}

/**
 * Setup Express error handler (call this AFTER all routes)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setupExpressErrorHandler(app: any): void {
    if (!isInitialized) return;
    Sentry.setupExpressErrorHandler(app);
}

// Re-export Sentry for advanced usage
export { Sentry };
