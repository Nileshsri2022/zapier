export interface RateLimitConfig {
  maxRequestsPerSecond: number;
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
  quotaLimit: number; // Gmail API quota units
}

export interface RequestRecord {
  timestamp: number;
  quotaUnits: number;
}

export class GmailRateLimiter {
  private requests: RequestRecord[] = [];
  private config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      maxRequestsPerSecond: 10,    // Conservative limit
      maxRequestsPerMinute: 100,   // Conservative limit
      maxRequestsPerHour: 1000,    // Conservative limit
      quotaLimit: 250,             // Gmail's per-user quota limit
      ...config,
    };
  }

  /**
   * Check if request can proceed based on rate limits
   */
  canMakeRequest(quotaUnits: number = 1): { allowed: boolean; waitTime?: number } {
    const now = Date.now();

    // Clean old requests (older than 1 hour)
    this.cleanupOldRequests(now - 3600000);

    // Check per-second limit
    const requestsLastSecond = this.getRequestsInWindow(now - 1000);
    if (requestsLastSecond >= this.config.maxRequestsPerSecond) {
      return { allowed: false, waitTime: 1000 };
    }

    // Check per-minute limit
    const requestsLastMinute = this.getRequestsInWindow(now - 60000);
    if (requestsLastMinute >= this.config.maxRequestsPerMinute) {
      return { allowed: false, waitTime: 60000 };
    }

    // Check per-hour limit
    const requestsLastHour = this.getRequestsInWindow(now - 3600000);
    if (requestsLastHour >= this.config.maxRequestsPerHour) {
      return { allowed: false, waitTime: 3600000 };
    }

    // Check quota limit
    const quotaUsed = this.getQuotaUsed();
    if (quotaUsed + quotaUnits > this.config.quotaLimit) {
      return { allowed: false, waitTime: 60000 }; // Wait 1 minute
    }

    return { allowed: true };
  }

  /**
   * Record a successful request
   */
  recordRequest(quotaUnits: number = 1): void {
    this.requests.push({
      timestamp: Date.now(),
      quotaUnits,
    });
  }

  /**
   * Get number of requests in a time window
   */
  private getRequestsInWindow(since: number): number {
    return this.requests.filter(req => req.timestamp >= since).length;
  }

  /**
   * Get total quota units used
   */
  private getQuotaUsed(): number {
    return this.requests.reduce((total, req) => total + req.quotaUnits, 0);
  }

  /**
   * Clean up old request records
   */
  private cleanupOldRequests(olderThan: number): void {
    this.requests = this.requests.filter(req => req.timestamp >= olderThan);
  }

  /**
   * Get current rate limit status
   */
  getStatus(): {
    requestsPerSecond: number;
    requestsPerMinute: number;
    requestsPerHour: number;
    quotaUsed: number;
    quotaRemaining: number;
  } {
    const now = Date.now();
    const requestsLastSecond = this.getRequestsInWindow(now - 1000);
    const requestsLastMinute = this.getRequestsInWindow(now - 60000);
    const requestsLastHour = this.getRequestsInWindow(now - 3600000);
    const quotaUsed = this.getQuotaUsed();

    return {
      requestsPerSecond: requestsLastSecond,
      requestsPerMinute: requestsLastMinute,
      requestsPerHour: requestsLastHour,
      quotaUsed,
      quotaRemaining: this.config.quotaLimit - quotaUsed,
    };
  }
}
