export enum GmailErrorType {
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INVALID_REQUEST = 'INVALID_REQUEST',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  SERVER_ERROR = 'SERVER_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface GmailError {
  type: GmailErrorType;
  message: string;
  statusCode?: number;
  retryable: boolean;
  retryAfter?: number; // seconds to wait before retry
  quotaResetTime?: Date;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
}

export class GmailErrorHandler {
  private static readonly DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 5,
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    backoffMultiplier: 2,
  };

  private circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private circuitBreakerTimeout = 60000; // 1 minute

  /**
   * Classify Gmail API error and determine handling strategy
   */
  static classifyError(error: any): GmailError {
    // Handle different types of Gmail API errors
    if (error?.code === 429) {
      const retryAfter = this.parseRetryAfter(error?.response?.headers?.['retry-after']);
      return {
        type: GmailErrorType.RATE_LIMIT_EXCEEDED,
        message: 'Gmail API rate limit exceeded',
        statusCode: 429,
        retryable: true,
        retryAfter: retryAfter || 60,
      };
    }

    if (error?.code === 403) {
      const errorReason = error?.errors?.[0]?.reason;

      if (errorReason === 'quotaExceeded') {
        return {
          type: GmailErrorType.QUOTA_EXCEEDED,
          message: 'Gmail API quota exceeded',
          statusCode: 403,
          retryable: false,
          quotaResetTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        };
      }

      if (errorReason === 'insufficientPermissions') {
        return {
          type: GmailErrorType.PERMISSION_DENIED,
          message: 'Insufficient Gmail API permissions',
          statusCode: 403,
          retryable: false,
        };
      }
    }

    if (error?.code === 401) {
      return {
        type: GmailErrorType.AUTHENTICATION_ERROR,
        message: 'Gmail API authentication failed',
        statusCode: 401,
        retryable: false,
      };
    }

    if (error?.code === 400) {
      return {
        type: GmailErrorType.INVALID_REQUEST,
        message: 'Invalid Gmail API request',
        statusCode: 400,
        retryable: false,
      };
    }

    if (error?.code === 404) {
      return {
        type: GmailErrorType.RESOURCE_NOT_FOUND,
        message: 'Gmail resource not found',
        statusCode: 404,
        retryable: false,
      };
    }

    if (error?.code >= 500) {
      return {
        type: GmailErrorType.SERVER_ERROR,
        message: 'Gmail API server error',
        statusCode: error.code,
        retryable: true,
        retryAfter: 30,
      };
    }

    // Network errors
    if (error?.name === 'FetchError' || error?.message?.includes('network')) {
      return {
        type: GmailErrorType.NETWORK_ERROR,
        message: 'Network error connecting to Gmail API',
        retryable: true,
        retryAfter: 10,
      };
    }

    // Unknown errors
    return {
      type: GmailErrorType.UNKNOWN_ERROR,
      message: error?.message || 'Unknown Gmail API error',
      retryable: false,
    };
  }

  /**
   * Parse Retry-After header value
   */
  private static parseRetryAfter(retryAfter: string | undefined): number | undefined {
    if (!retryAfter) return undefined;

    const seconds = parseInt(retryAfter, 10);
    if (isNaN(seconds)) return undefined;

    return Math.min(seconds, 3600); // Cap at 1 hour
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  static calculateRetryDelay(attempt: number, config: RetryConfig = this.DEFAULT_RETRY_CONFIG): number {
    const delay = Math.min(
      config.baseDelay * Math.pow(config.backoffMultiplier, attempt),
      config.maxDelay
    );

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * delay;
    return Math.floor(delay + jitter);
  }

  /**
   * Execute operation with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig = GmailErrorHandler.DEFAULT_RETRY_CONFIG
  ): Promise<T> {
    let lastError: GmailError;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        // Check circuit breaker
        if (!this.isCircuitBreakerClosed()) {
          throw this.createCircuitBreakerError();
        }

        const result = await operation();

        // Success - reset circuit breaker
        this.onSuccess();

        return result;
      } catch (error) {
        const gmailError = GmailErrorHandler.classifyError(error);
        lastError = gmailError;

        // Don't retry non-retryable errors
        if (!gmailError.retryable) {
          this.onFailure();
          throw gmailError;
        }

        // Don't retry on last attempt
        if (attempt === config.maxRetries) {
          this.onFailure();
          throw gmailError;
        }

        // Calculate delay and wait
        const delay = gmailError.retryAfter
          ? gmailError.retryAfter * 1000
          : GmailErrorHandler.calculateRetryDelay(attempt, config);

        console.warn(`Gmail API error (attempt ${attempt + 1}/${config.maxRetries + 1}): ${gmailError.message}. Retrying in ${delay}ms...`);

        await this.delay(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Check if circuit breaker allows requests
   */
  private isCircuitBreakerClosed(): boolean {
    const now = Date.now();

    switch (this.circuitBreakerState) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        if (now - this.lastFailureTime > this.circuitBreakerTimeout) {
          this.circuitBreakerState = 'HALF_OPEN';
          return true;
        }
        return false;

      case 'HALF_OPEN':
        return true;

      default:
        return true;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.failureCount = 0;
    this.circuitBreakerState = 'CLOSED';
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    // Open circuit breaker after 5 consecutive failures
    if (this.failureCount >= 5) {
      this.circuitBreakerState = 'OPEN';
    }
  }

  /**
   * Create circuit breaker error
   */
  private createCircuitBreakerError(): GmailError {
    return {
      type: GmailErrorType.SERVER_ERROR,
      message: 'Circuit breaker is open - too many Gmail API failures',
      retryable: true,
      retryAfter: 60,
    };
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current circuit breaker status
   */
  getCircuitBreakerStatus(): {
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failureCount: number;
    lastFailureTime: number;
    timeout: number;
  } {
    return {
      state: this.circuitBreakerState,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      timeout: this.circuitBreakerTimeout,
    };
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.circuitBreakerState = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}
