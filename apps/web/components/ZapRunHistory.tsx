'use client';

import { useState, useEffect } from 'react';
import { X, Clock, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { API_URL } from '@/lib/config';

interface ZapRun {
  id: string;
  zapId: string;
  metadata: Record<string, any>;
  createdAt: string;
}

interface ZapRunHistoryProps {
  zapId: string;
  zapName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ZapRunHistory({ zapId, zapName, isOpen, onClose }: ZapRunHistoryProps) {
  const [runs, setRuns] = useState<ZapRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/zaps/${zapId}/runs?page=${pageNum}&limit=10`, {
        credentials: 'include', // Use httpOnly cookie for auth
      });
      const data = await res.json();

      if (res.ok) {
        if (pageNum === 1) {
          setRuns(data.data.runs);
        } else {
          setRuns((prev) => [...prev, ...data.data.runs]);
        }
        setHasMore(pageNum < data.data.pagination.totalPages);
      } else {
        setError(data.message || 'Failed to fetch runs');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && zapId) {
      setPage(1);
      setRuns([]);
      fetchRuns(1);
    }
  }, [isOpen, zapId]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchRuns(nextPage);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <div
      className="history-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="history-dialog">
        {/* Header */}
        <div className="history-header">
          <div>
            <h2 className="history-title">Run History</h2>
            <p className="history-sub">{zapName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="history-close-btn"
            aria-label="Close run history"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="history-body">
          {error && <div className="history-error">{error}</div>}

          {runs.length === 0 && !loading && !error && (
            <div className="history-empty">
              <Clock className="history-empty__icon" size={44} />
              <p className="history-empty__title">No runs yet</p>
              <p className="history-empty__sub">This Zap hasn't been triggered yet</p>
            </div>
          )}

          {/* Timeline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {runs.map((run) => (
              <div key={run.id} className="history-item">
                <div
                  className="history-item__header"
                  onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                >
                  <div className="history-item__summary">
                    <div className="history-status-dot" />
                    <span className="history-time">{formatTime(run.createdAt)}</span>
                    <span className="history-subtime">
                      {new Date(run.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  {expandedRun === run.id ? (
                    <ChevronUp className="history-toggle-icon" size={18} />
                  ) : (
                    <ChevronDown className="history-toggle-icon" size={18} />
                  )}
                </div>

                {/* Expanded Details */}
                {expandedRun === run.id && (
                  <div className="history-details">
                    <p className="history-details__label">Trigger Data:</p>
                    <pre className="history-pre">{JSON.stringify(run.metadata, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Load More */}
          {hasMore && runs.length > 0 && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="history-load-more"
            >
              {loading ? (
                <>
                  <Loader2 className="history-spinner" size={16} />
                  Loading...
                </>
              ) : (
                'Load More'
              )}
            </button>
          )}

          {loading && runs.length === 0 && (
            <div className="history-loading">
              <Loader2 className="history-spinner" size={32} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ZapRunHistory;
