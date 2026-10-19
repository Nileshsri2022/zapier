/** A skipped final action must finish the run; otherwise AI conditional routes hang forever. */
export async function advanceSkippedStage(
  stage: number,
  lastStage: number,
  next: () => Promise<unknown>,
  complete: () => Promise<unknown>
): Promise<void> {
  if (stage === lastStage) await complete();
  else await next();
}
