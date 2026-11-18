"use client";

import { createAuthClient } from "better-auth/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

/** Client navigateur des pages de connexion et de consentement de l'AS. */
export const authClient = createAuthClient({
  plugins: [oauthProviderClient()],
});
