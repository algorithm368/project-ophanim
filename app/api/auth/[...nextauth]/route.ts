import { handlers } from "@/auth";

// Auth.js's own endpoints (sign-in, callback, sign-out, session). The proxy in
// proxy.ts deliberately does not guard this path: gating the door behind
// itself would leave no way to knock.
export const { GET, POST } = handlers;
