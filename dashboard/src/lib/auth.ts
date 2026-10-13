// ============================================================
// src/lib/auth.ts — NextAuth config (credentials provider + bcrypt)
// ============================================================

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });
        if (!user) return null;

        const ok = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
};

// Helper to hash passwords for signup
export async function hashPassword(p: string) {
  return bcrypt.hash(p, 10);
}

// ============================================================
// Demo seed (P0-A hardening)
// ============================================================

// Feature flag: demo seeding is OPT-IN via ALLOW_DEMO_SEED=1.
// Default (unset or any other value) keeps the seed endpoint disabled.
export function isDemoSeedEnabled(): boolean {
  return process.env.ALLOW_DEMO_SEED === "1";
}

// Demo credentials exist ONLY as internal constants of the demo seed module.
// They must NEVER be returned by any API response (see /api/seed-demo).
export const DEMO_USER_EMAIL = "demo@agenteleads.com";
export const DEMO_USER_PASSWORD = "agente123";

// Helper to ensure a demo user exists (used by /api/seed-demo when enabled).
// P0-A: the demo account is least-privilege (role "user"), never an admin.
export async function ensureDemoUser() {
  const existing = await db.user.findUnique({
    where: { email: DEMO_USER_EMAIL },
  });
  if (existing) return existing;
  return db.user.create({
    data: {
      email: DEMO_USER_EMAIL,
      name: "Demo User",
      role: "user",
      passwordHash: await hashPassword(DEMO_USER_PASSWORD),
    },
  });
}
