/**
 * Derives the Docker container name from a run's friendly ID and attempt number.
 * Mirrors the supervisor's getRunnerId() naming convention.
 * @see apps/supervisor/src/util.ts:17-25
 */
export function deriveContainerName(friendlyId: string, attemptNumber?: number): string {
  const parts = ["runner", friendlyId.replace("run_", "")];

  if (attemptNumber && attemptNumber > 1) {
    parts.push(`attempt-${attemptNumber}`);
  }

  return parts.join("-");
}
