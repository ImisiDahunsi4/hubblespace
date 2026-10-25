/**
 * Auth hooks — the Base44 replacement for `@convex-dev/auth/react`.
 *
 * Semantics mapped:
 *   useConvexAuth()   → session probe via base44.auth.isAuthenticated()
 *   useAuthActions()  → signIn/signOut against Base44 auth
 *
 * signIn shapes the app uses (src/live/useJoin.ts, useAuthIdentity.ts):
 *   "anonymous"              → resolved no-op — Base44 has no anonymous
 *                              sign-in; guests stay local-only, which matches
 *                              "guest is a complete product" (§1).
 *   "email-otp", {email}     → register(), which emails the OTP; the card's
 *                              "code" stage then verifies it. A register that
 *                              fails because the account exists routes to the
 *                              hosted login page instead.
 *   "email-otp", {email,code}→ verifyOtp() + loginViaEmailPassword() using the
 *                              registration password minted for this session.
 *   "google"                 → loginWithProvider("google") redirect.
 */
import { useEffect, useMemo, useState } from "react";
import { base44 } from "./client";

const OTP_PW_PREFIX = "hubble-otp-pw:";

export function useConvexAuth(): { isLoading: boolean; isAuthenticated: boolean } {
  const [state, setState] = useState({ isLoading: true, isAuthenticated: false });
  useEffect(() => {
    let live = true;
    base44.auth
      .isAuthenticated()
      .then((isAuthenticated) => {
        if (live) setState({ isLoading: false, isAuthenticated });
      })
      .catch(() => {
        if (live) setState({ isLoading: false, isAuthenticated: false });
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export function useAuthActions() {
  return useMemo(
    () => ({
      signIn: async (
        provider?: string | { provider?: string },
        params?: { email?: string; code?: string; redirectTo?: string },
      ) => {
        const name = typeof provider === "string" ? provider : provider?.provider;
        if (name === "anonymous") {
          // Guests are the rollback path, not a gate — no hosted round-trip.
          return;
        }
        if (name === "google") {
          (base44.auth as any).loginWithProvider(
            "google",
            params?.redirectTo ?? window.location.pathname,
          );
          return;
        }
        if (name === "email-otp" && params?.email) {
          const email = params.email.trim().toLowerCase();
          if (!params.code) {
            // Send the code: registration is what emails the OTP. An existing
            // account means the hosted login page owns the flow from here.
            const password = `hbl-${crypto.randomUUID()}`;
            try {
              await (base44.auth as any).register({
                email,
                password,
                full_name: email.split("@")[0],
              });
              window.sessionStorage.setItem(OTP_PW_PREFIX + email, password);
            } catch (err) {
              // Already registered → the hosted login page does the real flow.
              console.warn("[hubble] register route → hosted login", err);
              base44.auth.redirectToLogin(window.location.href);
              return;
            }
            return;
          }
          await (base44.auth as any).verifyOtp({ email, otpCode: params.code });
          const pw = window.sessionStorage.getItem(OTP_PW_PREFIX + email);
          if (pw) {
            try {
              await (base44.auth as any).loginViaEmailPassword(email, pw);
            } catch {
              /* verifyOtp may already have established the session */
            }
          }
          return;
        }
        base44.auth.redirectToLogin(window.location.href);
      },
      signOut: async () => {
        base44.auth.logout(window.location.href);
      },
    }),
    [],
  );
}
