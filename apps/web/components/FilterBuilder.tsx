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
      const res = await fetch(`${API_URL}/api/zaps/${zapId}/filters`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Use httpOnly cookie for auth
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
    <div className="filter-builder">
      {/* Header */}
      <div
        className="filter-builder__header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="filter-builder__head-left">
          <Filter size={18} className="filter-builder__icon" />
          <span className="filter-builder__title">Filters</span>
          {conditions.length > 0 && (
            <span className="filter-builder__count">
              {conditions.length}
            </span>
          )}
        </div>
        <div className="filter-builder__head-right">
          {conditions.length === 0 && (
            <span className="filter-builder__empty-hint">No filters - all triggers run</span>
          )}
          {isExpanded ? (
            <ChevronUp size={18} style={{ color: 'hsl(var(--muted-foreground))' }} />
          ) : (
            <ChevronDown size={18} style={{ color: 'hsl(var(--muted-foreground))' }} />
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="filter-builder__body">
          {/* Condition Rows */}
          {conditions.map((condition, index) => (
            <div key={index} className="filter-builder__row">
              {/* Field */}
              <input
                type="text"
                placeholder="Field (e.g. data.amount)"
                value={condition.field}
                onChange={(e) => updateCondition(index, 'field', e.target.value)}
                className="filter-builder__input"
              />

              {/* Operator */}
              <select
                value={condition.operator}
                onChange={(e) => updateCondition(index, 'operator', e.target.value)}
                className="filter-builder__select"
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
                  className="filter-builder__input"
                />
              )}

              {/* Remove */}
              <button
                type="button"
                onClick={() => removeCondition(index)}
                className="filter-builder__delete-btn"
                aria-label={`Remove filter condition ${index + 1}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}

          {/* Actions */}
          <div className="filter-builder__actions">
            <button
              type="button"
              onClick={addCondition}
              className="filter-builder__add-btn"
            >
              <Plus size={16} />
              Add Condition
            </button>

            {conditions.length > 0 && (
              <button
                type="button"
                onClick={saveFilters}
                disabled={isSaving}
                className="filter-builder__save-btn"
              >
                <Save size={14} />
                {isSaving ? 'Saving...' : 'Save Filters'}
              </button>
            )}
          </div>

          {/* Help Text */}
          <p className="filter-builder__help">
            Filters run before actions. If conditions don&apos;t match, the Zap will skip.
          </p>
        </div>
      )}
    </div>
  );
}

export default FilterBuilder;
