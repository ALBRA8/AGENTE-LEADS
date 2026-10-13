// Login page — server component wrapper (P0-A hardening).
// Reads the demo-seed flag server-side and only surfaces the demo login
// (including its credentials) when ALLOW_DEMO_SEED=1. Normal credential
// login works regardless of the flag.
import {
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  isDemoSeedEnabled,
} from "@/lib/auth";
import LoginForm, { type DemoCredentials } from "./login-form";

// Evaluate the flag per request so demo mode can be toggled via env
// without requiring a rebuild.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const demo: DemoCredentials | null = isDemoSeedEnabled()
    ? { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD }
    : null;

  return <LoginForm demo={demo} />;
}
