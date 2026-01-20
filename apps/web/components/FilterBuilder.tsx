'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Filter, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { API_URL } from '@/lib/config';
import { toast } from 'react-toastify';

// Available filter operators
const OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does Not Contain' },
  { value: 'greater_than', label: 'Greater Than' },
  { value: 'less_than', label: 'Less Than' },
  { value: 'is_empty', label: 'Is Empty' },
  { value: 'is_not_empty', label: 'Is Not Empty' },
  { value: 'starts_with', label: 'Starts With' },
  { value: 'ends_with', label: 'Ends With' },
];

export interface FilterCondition {
  field: string;
  operator: string;
  value: string;
}

interface FilterBuilderProps {
  zapId: string;
  initialConditions?: FilterCondition[];
  onSave?: (conditions: FilterCondition[]) => void;
}

export function FilterBuilder({ zapId, initialConditions = [], onSave }: FilterBuilderProps) {
  const [conditions, setConditions] = useState<FilterCondition[]>(initialConditions);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setConditions(initialConditions);
  }, [initialConditions]);

  const addCondition = () => {
    setConditions([...conditions, { field: '', operator: 'equals', value: '' }]);
    setIsExpanded(true);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, field: keyof FilterCondition, value: string) => {
    const updated = conditions.map((condition, i) => {
      if (i === index) {
        return { ...condition, [field]: value } as FilterCondition;
      }
      return condition;
    });
    setConditions(updated);
  };

  const saveFilters = async () => {
    if (!zapId) {
      toast.error('Please save the Zap first');
      return;
    }

    setIsSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/zaps/${zapId}/filters`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ filterConditions: conditions }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success('Filters saved!');
        onSave?.(conditions);
      } else {
        toast.error(data.message || 'Failed to save filters');
      }
    } catch (err) {
      toast.error('Failed to save filters');
    } finally {
      setIsSaving(false);
    }
  };

  const noValueOperators = ['is_empty', 'is_not_empty'];

  return (
    <div className="bg-[#1f1f3a] rounded-lg border border-purple-500/30 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-purple-500/10"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-purple-400" />
          <span className="text-white font-medium">Filters</span>
          {conditions.length > 0 && (
            <span className="bg-purple-500/30 text-purple-300 text-xs px-2 py-0.5 rounded-full">
              {conditions.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {conditions.length === 0 && (
            <span className="text-gray-500 text-sm">No filters - all triggers run</span>
          )}
          {isExpanded ? (
            <ChevronUp className="text-gray-400" size={18} />
          ) : (
            <ChevronDown className="text-gray-400" size={18} />
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-3 pt-0 space-y-3">
          {/* Condition Rows */}
          {conditions.map((condition, index) => (
            <div key={index} className="flex gap-2 items-center">
              {/* Field */}
              <input
                type="text"
                placeholder="Field (e.g. data.amount)"
                value={condition.field}
                onChange={(e) => updateCondition(index, 'field', e.target.value)}
                className="flex-1 bg-[#2a2a4a] text-white px-3 py-2 rounded border border-gray-600 focus:border-purple-500 focus:outline-none text-sm"
              />

              {/* Operator */}
              <select
                value={condition.operator}
                onChange={(e) => updateCondition(index, 'operator', e.target.value)}
                className="bg-[#2a2a4a] text-white px-3 py-2 rounded border border-gray-600 focus:border-purple-500 focus:outline-none text-sm"
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>

              {/* Value (hidden for is_empty/is_not_empty) */}
              {!noValueOperators.includes(condition.operator) && (
                <input
                  type="text"
                  placeholder="Value"
                  value={condition.value}
                  onChange={(e) => updateCondition(index, 'value', e.target.value)}
                  className="flex-1 bg-[#2a2a4a] text-white px-3 py-2 rounded border border-gray-600 focus:border-purple-500 focus:outline-none text-sm"
                />
              )}

              {/* Remove */}
              <button
                onClick={() => removeCondition(index)}
                className="p-2 text-red-400 hover:bg-red-500/20 rounded"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={addCondition}
              className="flex items-center gap-1 text-purple-400 hover:text-purple-300 text-sm"
            >
              <Plus size={16} />
              Add Condition
            </button>

            {conditions.length > 0 && (
              <button
                onClick={saveFilters}
                disabled={isSaving}
                className="ml-auto flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
              >
                <Save size={14} />
                {isSaving ? 'Saving...' : 'Save Filters'}
              </button>
            )}
          </div>

          {/* Help Text */}
          <p className="text-xs text-gray-500 pt-2">
            Filters run before actions. If conditions don&apos;t match, the Zap will skip.
          </p>
        </div>
      )}
    </div>
  );
}

export default FilterBuilder;
