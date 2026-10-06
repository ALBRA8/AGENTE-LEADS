// ============================================================
// src/app/prospectos/page.tsx — CRM
// ============================================================

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { CrmClient } from "@/components/prospects/crm-client";

export default async function ProspectosPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  return (
    <AppShell>
      <div className="p-4 md:p-6 lg:p-8">
        <CrmClient />
      </div>
    </AppShell>
  );
}
