/**
 * Dashboard server health check.
 *
 * Thin re-export over `@blackbelt-technology/pi-dashboard-shared/server-identity.js`
 * so the Electron main process and the dashboard server share a single
 * retry-aware probe implementation.
 *
 * The shared module is reachable from packaged Electron (other modules
 * under `lib/` — wizard-ipc, server-lifecycle, dependency-detector,
 * doctor, update-checker, launch-source, doctor-window — already import
 * shared submodules; the historical "MUST NOT import from shared" note
 * no longer applies).
 *
 * See change: harvest-bootstrap-survivor-fixes (cherry-pick 3).
 */
export type {
  DashboardStatus,
  DashboardCheckOpts,
} from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
export { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
