// ============================================================
// src/app/propuestas/page.tsx — Proposals list
// ============================================================

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ProposalsClient } from "@/components/prospects/proposals-client";

export default async function PropuestasPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  return (
    <AppShell>
      <div className="p-4 md:p-6 lg:p-8">
        <ProposalsClient />
      </div>
    </AppShell>
  );
}
