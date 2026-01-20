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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1a2e] rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-white">Run History</h2>
            <p className="text-sm text-gray-400">{zapName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {error && <div className="text-red-400 text-center py-4">{error}</div>}

          {runs.length === 0 && !loading && !error && (
            <div className="text-center py-12">
              <Clock className="mx-auto text-gray-500 mb-3" size={48} />
              <p className="text-gray-400">No runs yet</p>
              <p className="text-gray-500 text-sm">This Zap hasn't been triggered yet</p>
            </div>
          )}

          {/* Timeline */}
          <div className="space-y-3">
            {runs.map((run) => (
              <div
                key={run.id}
                className="bg-[#252542] rounded-lg p-4 hover:bg-[#2a2a4a] transition-colors"
              >
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-white font-medium">{formatTime(run.createdAt)}</span>
                    <span className="text-gray-400 text-sm">
                      {new Date(run.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  {expandedRun === run.id ? (
                    <ChevronUp className="text-gray-400" size={20} />
                  ) : (
                    <ChevronDown className="text-gray-400" size={20} />
                  )}
                </div>

                {/* Expanded Details */}
                {expandedRun === run.id && (
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <p className="text-xs text-gray-500 mb-2">Trigger Data:</p>
                    <pre className="bg-[#1a1a2e] p-3 rounded text-xs text-gray-300 overflow-x-auto">
                      {JSON.stringify(run.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Load More */}
          {hasMore && runs.length > 0 && (
            <button
              onClick={loadMore}
              disabled={loading}
              className="w-full mt-4 py-2 bg-[#252542] text-white rounded-lg hover:bg-[#2a2a4a] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Loading...
                </>
              ) : (
                'Load More'
              )}
            </button>
          )}

          {loading && runs.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-purple-500" size={32} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ZapRunHistory;
