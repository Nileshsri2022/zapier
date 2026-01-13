'use client';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import Button from './Button';

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
  const [circuitBreakerStatus, setCircuitBreakerStatus] = useState<CircuitBreakerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchGmailServers = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      const response = await axios.get('http://localhost:5000/api/gmail/servers', {
        headers: { Authorization: token }
      });

      setServers(response.data.gmailServers || []);
    } catch (error: any) {
      toast.error('Failed to fetch Gmail servers: ' + (error.response?.data?.message || error.message));
    }
  };

  const fetchServerStatus = async (serverId: string) => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      const response = await axios.get(`http://localhost:5000/api/gmail/servers/${serverId}/ratelimit`, {
        headers: { Authorization: token }
      });

      setRateLimitStatus(response.data.rateLimitStatus);
      setCircuitBreakerStatus(response.data.circuitBreakerStatus);
      setLastUpdated(new Date());
    } catch (error: any) {
      toast.error('Failed to fetch server status: ' + (error.response?.data?.message || error.message));
    } finally {
      setIsLoading(false);
    }
  };

  const resetCircuitBreaker = async (serverId: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      await axios.post(`http://localhost:5000/api/gmail/servers/${serverId}/reset-circuit`, {}, {
        headers: { Authorization: token }
      });

      toast.success('Circuit breaker reset successfully');
      fetchServerStatus(serverId); // Refresh status
    } catch (error: any) {
      toast.error('Failed to reset circuit breaker: ' + (error.response?.data?.message || error.message));
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'CLOSED':
        return 'bg-green-100 text-green-800';
      case 'OPEN':
        return 'bg-red-100 text-red-800';
      case 'HALF_OPEN':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
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
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Gmail Status Monitor</h2>
        <select
          value={selectedServer}
          onChange={(e) => setSelectedServer(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="">Select Gmail Server</option>
          {servers.map(server => (
            <option key={server.id} value={server.id}>{server.name}</option>
          ))}
        </select>
      </div>

      {!selectedServer ? (
        <div className="text-center py-8 text-gray-500">
          <p>Select a Gmail server to view its status and performance metrics.</p>
        </div>
      ) : isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading server status...</p>
        </div>
      ) : !rateLimitStatus || !circuitBreakerStatus ? (
        <div className="text-center py-8 text-gray-500">
          <p>Unable to load server status. Please try again.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Rate Limit Status */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold mb-4">Rate Limit Status</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>API Quota Usage</span>
                  <span>{rateLimitStatus.quotaUsed} / {rateLimitStatus.quotaUsed + rateLimitStatus.quotaRemaining}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${getQuotaPercentage()}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {rateLimitStatus.quotaRemaining} quota units remaining
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-blue-600">{rateLimitStatus.requestsPerSecond}</p>
                  <p className="text-xs text-gray-600">Req/Sec</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">{rateLimitStatus.requestsPerMinute}</p>
                  <p className="text-xs text-gray-600">Req/Min</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-purple-600">{rateLimitStatus.requestsPerHour}</p>
                  <p className="text-xs text-gray-600">Req/Hour</p>
                </div>
              </div>
            </div>
          </div>

          {/* Circuit Breaker Status */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Circuit Breaker</h3>
              <Button
                variant="outline"
                size="md"
                onClick={() => resetCircuitBreaker(selectedServer)}
              >
                Reset
              </Button>
            </div>

            <div className="space-y-4">
              <div>
                <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(circuitBreakerStatus.state)}`}>
                  {circuitBreakerStatus.state}
                </span>
                <p className="text-sm text-gray-600 mt-1">
                  {circuitBreakerStatus.state === 'CLOSED' && 'System operating normally'}
                  {circuitBreakerStatus.state === 'OPEN' && 'Too many failures - requests blocked'}
                  {circuitBreakerStatus.state === 'HALF_OPEN' && 'Testing if service recovered'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Failure Count</p>
                  <p className="text-lg font-semibold">{circuitBreakerStatus.failureCount}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Timeout</p>
                  <p className="text-lg font-semibold">{Math.round(circuitBreakerStatus.timeout / 1000)}s</p>
                </div>
              </div>

              {circuitBreakerStatus.lastFailureTime > 0 && (
                <div>
                  <p className="text-sm text-gray-600">Last Failure</p>
                  <p className="text-sm">
                    {new Date(circuitBreakerStatus.lastFailureTime).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="bg-white p-6 rounded-lg shadow-md lg:col-span-2">
            <h3 className="text-lg font-semibold mb-4">Performance Metrics</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <p className="text-2xl font-bold text-blue-600">
                  {rateLimitStatus.requestsPerSecond < 5 ? '🟢' : rateLimitStatus.requestsPerSecond < 8 ? '🟡' : '🔴'}
                </p>
                <p className="text-sm text-gray-600">Per Second</p>
                <p className="text-xs text-gray-500">Rate: {rateLimitStatus.requestsPerSecond}/10</p>
              </div>

              <div className="text-center p-3 bg-green-50 rounded-lg">
                <p className="text-2xl font-bold text-green-600">
                  {rateLimitStatus.requestsPerMinute < 50 ? '🟢' : rateLimitStatus.requestsPerMinute < 80 ? '🟡' : '🔴'}
                </p>
                <p className="text-sm text-gray-600">Per Minute</p>
                <p className="text-xs text-gray-500">Rate: {rateLimitStatus.requestsPerMinute}/100</p>
              </div>

              <div className="text-center p-3 bg-purple-50 rounded-lg">
                <p className="text-2xl font-bold text-purple-600">
                  {getQuotaPercentage() < 50 ? '🟢' : getQuotaPercentage() < 80 ? '🟡' : '🔴'}
                </p>
                <p className="text-sm text-gray-600">Quota Usage</p>
                <p className="text-xs text-gray-500">{Math.round(getQuotaPercentage())}%</p>
              </div>

              <div className="text-center p-3 bg-orange-50 rounded-lg">
                <p className="text-2xl font-bold text-orange-600">
                  {circuitBreakerStatus.state === 'CLOSED' ? '🟢' : circuitBreakerStatus.state === 'HALF_OPEN' ? '🟡' : '🔴'}
                </p>
                <p className="text-sm text-gray-600">Health</p>
                <p className="text-xs text-gray-500 capitalize">{circuitBreakerStatus.state}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {lastUpdated && (
        <div className="text-center text-sm text-gray-500 mt-4">
          Last updated: {lastUpdated.toLocaleString()}
        </div>
      )}
    </div>
  );
};

export default GmailStatusMonitor;
