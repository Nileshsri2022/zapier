/** Ingress JSON is not a trusted source of persisted step results.
 * A fresh (pending) run must discard worker-reserved keys before it becomes running.
 * Later deliveries retain outputs written by the worker for replay/chaining.
 */
export function prepareRunMetadata(raw: unknown, fresh: boolean): Record<string, unknown> {
  const metadata: Record<string, unknown> = raw && typeof raw === 'object' ? { ...raw } : {};
  if (fresh) {
    delete metadata.stepOutputs;
    delete metadata.previousOutput;
  }
  return metadata;
}
