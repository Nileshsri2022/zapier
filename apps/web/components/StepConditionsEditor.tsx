'use client';
import type { StepCondition } from '@repo/types';
const operators: StepCondition['operator'][] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'less_than',
  'greater_than_or_equals',
  'less_than_or_equals',
  'is_empty',
  'is_not_empty',
  'starts_with',
  'ends_with',
];
export default function StepConditionsEditor({
  step,
  conditions,
  onChange,
}: {
  step: number;
  conditions: StepCondition[];
  onChange: (value: StepCondition[]) => void;
}) {
  const update = (index: number, patch: Partial<StepCondition>) =>
    onChange(
      conditions.map((condition, i) => (i === index ? { ...condition, ...patch } : condition))
    );
  return (
    <details className="ai-step-conditions">
      <summary>
        Only run action {step} if… ({conditions.length} conditions)
      </summary>
      <p>
        All conditions must match. For AI routing, use <code>previousOutput.fields.category</code>,
        equals, negative. Leave empty to always run.
      </p>
      {conditions.map((condition, index) => (
        <div className="ai-condition-row" key={index}>
          <input
            aria-label={`Action ${step} condition ${index + 1} field`}
            value={condition.field}
            placeholder="previousOutput.fields.category"
            maxLength={200}
            onChange={(e) => update(index, { field: e.target.value })}
          />
          <select
            aria-label={`Action ${step} condition ${index + 1} operator`}
            value={condition.operator}
            onChange={(e) =>
              update(index, { operator: e.target.value as StepCondition['operator'] })
            }
          >
            {operators.map((operator) => (
              <option key={operator} value={operator}>
                {operator.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          {!['is_empty', 'is_not_empty'].includes(condition.operator) && (
            <input
              aria-label={`Action ${step} condition ${index + 1} value`}
              value={condition.value}
              maxLength={1000}
              placeholder="negative"
              onChange={(e) => update(index, { value: e.target.value })}
            />
          )}
          <button
            type="button"
            aria-label={`Remove action ${step} condition ${index + 1}`}
            onClick={() => onChange(conditions.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={conditions.length >= 20}
        onClick={() =>
          onChange([
            ...conditions,
            { field: 'previousOutput.fields.category', operator: 'equals', value: 'negative' },
          ])
        }
      >
        Add step condition
      </button>
    </details>
  );
}
