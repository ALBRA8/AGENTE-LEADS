// ============================================================
// src/app/ajustes/page.tsx — Settings (offers CRUD + integrations)
// ============================================================

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SettingsClient } from "@/components/offers/settings-client";

export default async function AjustesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  return (
    <AppShell>
      <div className="p-4 md:p-6 lg:p-8">
        <SettingsClient />
      </div>
    </AppShell>
  );
}
