/**
 * Filter Evaluation Utility
 * Evaluates filter conditions against trigger data
 */

export interface FilterCondition {
  field: string; // e.g., "data.amount" or "email"
  operator: string; // equals, not_equals, contains, greater_than, etc.
  value: string; // comparison value
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => {
    return current?.[key];
  }, obj);
}

/**
 * Evaluate a single condition
 */
function evaluateCondition(condition: FilterCondition, data: any): boolean {
  const actualValue = getNestedValue(data, condition.field);
  const expectedValue = condition.value;

  switch (condition.operator) {
    case 'equals':
      return String(actualValue) === String(expectedValue);

    case 'not_equals':
      return String(actualValue) !== String(expectedValue);

    case 'contains':
      return String(actualValue).toLowerCase().includes(String(expectedValue).toLowerCase());

    case 'not_contains':
      return !String(actualValue).toLowerCase().includes(String(expectedValue).toLowerCase());

    case 'greater_than':
      return Number(actualValue) > Number(expectedValue);

    case 'less_than':
      return Number(actualValue) < Number(expectedValue);

    case 'greater_than_or_equals':
      return Number(actualValue) >= Number(expectedValue);

    case 'less_than_or_equals':
      return Number(actualValue) <= Number(expectedValue);

    case 'is_empty':
      return actualValue === null || actualValue === undefined || actualValue === '';

    case 'is_not_empty':
      return actualValue !== null && actualValue !== undefined && actualValue !== '';

    case 'starts_with':
      return String(actualValue).toLowerCase().startsWith(String(expectedValue).toLowerCase());

    case 'ends_with':
      return String(actualValue).toLowerCase().endsWith(String(expectedValue).toLowerCase());

    default:
      // A filter is an authorization-shaped decision ("do not run unless …"),
      // so an operator we cannot evaluate must never be read as "pass".
      console.error(
        `Unknown operator "${condition.operator}" on field "${condition.field}": ` +
          `treating the condition as NOT met (fail closed)`
      );
      return false;
  }
}

/**
 * Evaluate all filter conditions (AND logic)
 * Returns true if ALL conditions pass, false otherwise
 */
export function evaluateFilters(conditions: FilterCondition[], data: any): boolean {
  // No conditions = always pass
  if (!conditions || conditions.length === 0) {
    return true;
  }

  const results = conditions.map((condition) => {
    const result = evaluateCondition(condition, data);
    console.log(
      `📋 Filter: "${condition.field}" ${condition.operator} "${condition.value}" → ${result ? 'PASS' : 'FAIL'}`
    );
    return result;
  });

  const allPass = results.every((r) => r);
  console.log(`📋 Filter result: ${allPass ? 'ALL PASS ✅' : 'BLOCKED ❌'}`);

  return allPass;
}

export default evaluateFilters;
