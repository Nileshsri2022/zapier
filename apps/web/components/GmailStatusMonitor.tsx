'use client';
import { API_URL } from '@/lib/config';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import Button from './Button';
import { Spinner } from './ui/spinner';

interface GmailServer {
  id: string;
  name: string;
  isActive: boolean;
}

interface RateLimitStatus {
  requestsPerSecond: number;
  requestsPerMinute: number;
  requestsPerHour: number;
  quotaUsed: number;
  quotaRemaining: number;
}

interface CircuitBreakerStatus {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailureTime: number;
  timeout: number;
}

const GmailStatusMonitor = () => {
  const [servers, setServers] = useState<GmailServer[]>([]);
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [rateLimitStatus, setRateLimitStatus] = useState<RateLimitStatus | null>(null);
  const [circuitBreakerStatus, setCircuitBreakerStatus] = useState<CircuitBreakerStatus | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchGmailServers = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/gmail/servers`, {
        withCredentials: true, // Cookie auth
      });

      setServers(response.data.gmailServers || []);
    } catch (error: any) {
      toast.error(
        'Failed to fetch Gmail servers: ' + (error.response?.data?.message || error.message)
      );
    }
  };

  const fetchServerStatus = async (serverId: string) => {
    try {
      setIsLoading(true);

      const response = await axios.get(`${API_URL}/api/gmail/servers/${serverId}/ratelimit`, {
        withCredentials: true, // Cookie auth
      });

      setRateLimitStatus(response.data.rateLimitStatus);
      setCircuitBreakerStatus(response.data.circuitBreakerStatus);
      setLastUpdated(new Date());
    } catch (error: any) {
      toast.error(
        'Failed to fetch server status: ' + (error.response?.data?.message || error.message)
      );
    } finally {
      setIsLoading(false);
    }
  };

  const resetCircuitBreaker = async (serverId: string) => {
    try {
      await axios.post(
        `${API_URL}/api/gmail/servers/${serverId}/reset-circuit`,
        {},
        {
          withCredentials: true, // Cookie auth
        }
      );

      toast.success('Circuit breaker reset successfully');
      fetchServerStatus(serverId); // Refresh status
    } catch (error: any) {
      toast.error(
        'Failed to reset circuit breaker: ' + (error.response?.data?.message || error.message)
      );
    }
  };

  // Tone token only — the colour mapping lives in styles/components/gmail.css.
  const getStatusTone = (status: string) => {
    switch (status) {
      case 'CLOSED':
        return 'ok';
      case 'OPEN':
        return 'alert';
      case 'HALF_OPEN':
        return 'warn';
      default:
        return 'idle';
    }
  };

  const getQuotaPercentage = () => {
    if (!rateLimitStatus) return 0;
    const total = rateLimitStatus.quotaUsed + rateLimitStatus.quotaRemaining;
    return total > 0 ? (rateLimitStatus.quotaUsed / total) * 100 : 0;
  };

  useEffect(() => {
    fetchGmailServers();
  }, []);

  useEffect(() => {
    if (selectedServer) {
      fetchServerStatus(selectedServer);
      // Auto-refresh every 30 seconds
      const interval = setInterval(() => {
        fetchServerStatus(selectedServer);
      }, 30000);

      return () => clearInterval(interval);
    } else {
      setRateLimitStatus(null);
      setCircuitBreakerStatus(null);
      setLastUpdated(null);
    }
  }, [selectedServer]);

  return (
    <div className="gmail-panel">
      <div className="gmail-panel__head">
        <h2 className="gmail-panel__title">Gmail Status Monitor</h2>
        <select
          value={selectedServer}
          onChange={(e) => setSelectedServer(e.target.value)}
          className="gmail-select"
        >
          <option value="">Select Gmail Server</option>
          {servers.map((server) => (
            <option key={server.id} value={server.id}>
              {server.name}
            </option>
          ))}
        </select>
      </div>

      {!selectedServer ? (
        <div className="gmail-empty">
          <p>Select a Gmail server to view its status and performance metrics.</p>
        </div>
      ) : isLoading ? (
        <div className="gmail-empty">
          <Spinner color="primary" />
          <p className="gmail-empty__text">Loading server status...</p>
        </div>
      ) : !rateLimitStatus || !circuitBreakerStatus ? (
        <div className="gmail-empty">
          <p>Unable to load server status. Please try again.</p>
        </div>
      ) : (
        <div className="gmail-grid">
          {/* Rate Limit Status */}
          <div className="gmail-card">
            <h3 className="gmail-card__title">Rate Limit Status</h3>
            <div className="gmail-stack">
              <div>
                <div className="gmail-meter__label">
                  <span>API Quota Usage</span>
                  <span>
                    {rateLimitStatus.quotaUsed} /{' '}
                    {rateLimitStatus.quotaUsed + rateLimitStatus.quotaRemaining}
                  </span>
                </div>
                <div className="gmail-meter">
                  <div
                    className="gmail-meter__fill"
                    style={{ width: `${getQuotaPercentage()}%` }}
                  ></div>
                </div>
                <p className="gmail-hint">{rateLimitStatus.quotaRemaining} quota units remaining</p>
              </div>

              <div className="gmail-stats">
                <div>
                  <p className="gmail-stat__value" data-tone="info">
                    {rateLimitStatus.requestsPerSecond}
                  </p>
                  <p className="gmail-stat__label">Req/Sec</p>
                </div>
                <div>
                  <p className="gmail-stat__value" data-tone="success">
                    {rateLimitStatus.requestsPerMinute}
                  </p>
                  <p className="gmail-stat__label">Req/Min</p>
                </div>
                <div>
                  <p className="gmail-stat__value" data-tone="secondary">
                    {rateLimitStatus.requestsPerHour}
                  </p>
                  <p className="gmail-stat__label">Req/Hour</p>
                </div>
              </div>
            </div>
          </div>

          {/* Circuit Breaker Status */}
          <div className="gmail-card">
            <div className="gmail-card__head">
              <h3 className="gmail-card__title">Circuit Breaker</h3>
              <Button
                variant="outline"
                size="md"
                onClick={() => resetCircuitBreaker(selectedServer)}
              >
                Reset
              </Button>
            </div>

            <div className="gmail-stack">
              <div>
                <span className="gmail-pill" data-tone={getStatusTone(circuitBreakerStatus.state)}>
                  {circuitBreakerStatus.state}
                </span>
                <p className="gmail-hint">
                  {circuitBreakerStatus.state === 'CLOSED' && 'System operating normally'}
                  {circuitBreakerStatus.state === 'OPEN' && 'Too many failures - requests blocked'}
                  {circuitBreakerStatus.state === 'HALF_OPEN' && 'Testing if service recovered'}
                </p>
              </div>

              <div className="gmail-grid gmail-grid--pair">
                <div>
                  <p className="gmail-data__label">Failure Count</p>
                  <p className="gmail-data__value">{circuitBreakerStatus.failureCount}</p>
                </div>
                <div>
                  <p className="gmail-data__label">Timeout</p>
                  <p className="gmail-data__value">
                    {Math.round(circuitBreakerStatus.timeout / 1000)}s
                  </p>
                </div>
              </div>

              {circuitBreakerStatus.lastFailureTime > 0 && (
                <div>
                  <p className="gmail-data__label">Last Failure</p>
                  <p className="gmail-data__value">
                    {new Date(circuitBreakerStatus.lastFailureTime).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="gmail-card gmail-card--wide">
            <h3 className="gmail-card__title">Performance Metrics</h3>
            <div className="gmail-metrics">
              <div className="gmail-metric" data-tone="info">
                <p className="gmail-metric__value">
                  {rateLimitStatus.requestsPerSecond < 5
                    ? '🟢'
                    : rateLimitStatus.requestsPerSecond < 8
                      ? '🟡'
                      : '🔴'}
                </p>
                <p className="gmail-metric__label">Per Second</p>
                <p className="gmail-metric__note">Rate: {rateLimitStatus.requestsPerSecond}/10</p>
              </div>

              <div className="gmail-metric" data-tone="success">
                <p className="gmail-metric__value">
                  {rateLimitStatus.requestsPerMinute < 50
                    ? '🟢'
                    : rateLimitStatus.requestsPerMinute < 80
                      ? '🟡'
                      : '🔴'}
                </p>
                <p className="gmail-metric__label">Per Minute</p>
                <p className="gmail-metric__note">Rate: {rateLimitStatus.requestsPerMinute}/100</p>
              </div>

              <div className="gmail-metric" data-tone="secondary">
                <p className="gmail-metric__value">
                  {getQuotaPercentage() < 50 ? '🟢' : getQuotaPercentage() < 80 ? '🟡' : '🔴'}
                </p>
                <p className="gmail-metric__label">Quota Usage</p>
                <p className="gmail-metric__note">{Math.round(getQuotaPercentage())}%</p>
              </div>

              <div className="gmail-metric" data-tone="warning">
                <p className="gmail-metric__value">
                  {circuitBreakerStatus.state === 'CLOSED'
                    ? '🟢'
                    : circuitBreakerStatus.state === 'HALF_OPEN'
                      ? '🟡'
                      : '🔴'}
                </p>
                <p className="gmail-metric__label">Health</p>
                <p className="gmail-metric__note gmail-metric__note--cap">
                  {circuitBreakerStatus.state}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {lastUpdated && (
        <div className="gmail-updated">Last updated: {lastUpdated.toLocaleString()}</div>
      )}
    </div>
  );
};

export default GmailStatusMonitor;
