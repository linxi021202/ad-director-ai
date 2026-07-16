import "server-only";

import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";

import { getPrisma } from "@/lib/db";

function authSecret() {
  const configured = process.env.BETTER_AUTH_SECRET?.trim();
  if (configured) return configured;

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return "build-only-secret-never-valid-at-runtime";
  }

  throw new Error("BETTER_AUTH_SECRET is required before using authentication.");
}

function authBaseUrl() {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return "http://localhost:3000";
  }

  throw new Error("BETTER_AUTH_URL is required before running authentication in production.");
}

const betterAuthUrl = authBaseUrl();

export const auth = betterAuth({
  appName: "AdDirector AI",
  baseURL: betterAuthUrl,
  secret: authSecret(),
  database: prismaAdapter(getPrisma(), {
    provider: "postgresql"
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8
  },
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  },
  trustedOrigins: [betterAuthUrl]
});
