import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// the family board's layout; not imported from src/data/family.ts, which the Convex seed bundles
import "./data/family.css";
import App from "./App.tsx";
import { getDataMode } from "./live/dataMode.ts";
import { AuthIdentityBridge } from "./live/useAuthIdentity.ts";
import { UpdateNudge } from "./components/UpdateNudge.tsx";
import { DemoBanner, MAKE_SPACE_EVENT } from "./components/DemoBanner.tsx";
import { api, useQuery } from "./services/base44/shim";
import { getMutationImpl } from "./services/base44/impl/calls";
import { BASE44_APP_ID } from "./services/base44/client";
import { watchStandalone } from "./lib/standalone.ts";
import "./index.css";

const mode = getDataMode();

/* The installed app (kitchen iPad): stay awake, reconnect after sleep
   (features/ipad.md). The probe answers the watchdog's "is the line up" —
   navigator.onLine plus the actor/entity stack's own reconnects. */
const connectionProbe = {
  connectionState: () => ({ isWebSocketConnected: navigator.onLine }),
};
if (mode === "live" && BASE44_APP_ID) watchStandalone(connectionProbe);

function MissingBackendConfig() {
  return (
    <main className="convex-config-missing" data-data-mode="missing">
      <div>
        <span aria-hidden="true">✦</span>
        <strong>HubbleSpace isn’t connected to its backend</strong>
        <p>
          This build has no <code>VITE_BASE44_APP_ID</code>. Deploys from the
          Base44 workspace inject it automatically; for local dev set it in
          <code> .env.local</code> (see <code>.env.local.example</code>).
        </p>
        <small>
          Need the visual-only prototype? Add <code>?mock=1</code>.
        </small>
      </div>
    </main>
  );
}

/** Live: the banner asks the backend whether rooms are open. */
function LiveDemoBanner() {
  const open = useQuery(api.spaces.roomsOpen, {});
  return (
    <DemoBanner
      onJoinWaitlist={(email) => getMutationImpl("waitlist.join")({ email })}
      onMakeSpace={open ? () => window.dispatchEvent(new Event(MAKE_SPACE_EVENT)) : undefined}
      pending={open === undefined}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {mode !== "live" || !BASE44_APP_ID ? <DemoBanner /> : null}
    {mode === "live" && BASE44_APP_ID ? (
      <>
        {/* Guests stay local-only — Base44 has no anonymous sign-in, and the
            canvas is never behind sign-in (§1). */}
        <AuthIdentityBridge />
        <LiveDemoBanner />
        <App />
        <UpdateNudge />
      </>
    ) : mode === "mock" ? (
      <App />
    ) : (
      <MissingBackendConfig />
    )}
  </StrictMode>,
);
