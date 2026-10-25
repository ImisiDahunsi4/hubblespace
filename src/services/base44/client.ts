// HubbleSpace — the one Base44 client for the frontend.
// Live mode requires VITE_BASE44_APP_ID (injected by `base44 build`/`deploy`;
// set it in .env.local for `npm run dev`).
import { createClient } from "@base44/sdk";

export const BASE44_APP_ID = import.meta.env.VITE_BASE44_APP_ID as
  | string
  | undefined;

export const base44 = createClient({ appId: BASE44_APP_ID ?? "unconfigured" });
