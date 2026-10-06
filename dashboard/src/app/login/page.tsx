"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Sparkles, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const DEMO_EMAIL = "demo@agenteleads.com";
const DEMO_PASSWORD = "agente123";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Make sure demo user is seeded before login attempt
      try {
        await fetch("/api/seed-demo", { method: "POST" });
      } catch {}
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        toast.error("Credenciales inválidas");
      } else {
        toast.success("Bienvenido a AGENTE LEADS");
        router.push("/");
        router.refresh();
      }
    } catch {
      toast.error("Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  // One-click demo login — no typing required
  const onDemoLogin = async () => {
    setDemoLoading(true);
    // Make sure the demo user is seeded first
    try {
      await fetch("/api/seed-demo", { method: "POST" });
    } catch {}
    try {
      const res = await signIn("credentials", {
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        redirect: false,
      });
      if (res?.error) {
        toast.error("No se pudo entrar al demo. Intenta de nuevo.");
      } else {
        toast.success("Entrando al demo…");
        router.push("/");
        router.refresh();
      }
    } catch {
      toast.error("Error al entrar al demo");
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Sparkles className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AGENTE LEADS</h1>
            <p className="text-sm text-muted-foreground">
              Prospección inteligente B2B
            </p>
          </div>
        </div>

        {/* One-click demo entry — primary CTA */}
        <Button
          type="button"
          onClick={onDemoLogin}
          disabled={demoLoading}
          size="lg"
          className="w-full h-14 text-base font-semibold shadow-md"
        >
          {demoLoading ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Entrando…
            </>
          ) : (
            <>
              <Zap className="h-5 w-5 mr-2" />
              Ver demo (sin registro)
            </>
          )}
        </Button>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-3 text-muted-foreground">
              o entra con tu cuenta
            </span>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 bg-card border rounded-xl p-6 shadow-sm"
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Iniciar sesión
          </Button>

          <div className="text-xs text-center text-muted-foreground pt-2 border-t">
            Demo: <code className="font-mono">{DEMO_EMAIL}</code> /{" "}
            <code className="font-mono">{DEMO_PASSWORD}</code>
          </div>
        </form>

        <div className="text-center text-sm">
          ¿No tienes cuenta?{" "}
          <Link href="/signup" className="text-primary hover:underline">
            Crear cuenta nueva
          </Link>
        </div>
      </div>
    </div>
  );
}

