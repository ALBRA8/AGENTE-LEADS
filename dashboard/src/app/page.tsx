// ============================================================
// src/app/page.tsx — Dashboard (protected)
// ============================================================

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "@/components/dashboard/dashboard";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  return (
    <AppShell>
      <div className="p-4 md:p-6 lg:p-8">
        <Dashboard />
      </div>
    </AppShell>
  );
}
