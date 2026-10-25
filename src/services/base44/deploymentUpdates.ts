/**
 * `useDeploymentUpdates` — drop-in for @convex-dev/static-hosting.
 *
 * Convex's static-hosting component streamed a deployment row; Base44 has
 * no client-visible deployment channel, so this reports "no update" and
 * UpdateNudge stays dormant. The standalone watchdog (src/lib/standalone.ts)
 * still reloads a parked iPad on a dead line, which is the same recovery
 * the nudge existed for.
 */
export function useDeploymentUpdates() {
  return {
    updateAvailable: false,
    deployment: null as { currentDeploymentId: string } | null,
    setupError: null as string | null,
    reload: () => window.location.reload(),
    dismiss: () => {},
  };
}
