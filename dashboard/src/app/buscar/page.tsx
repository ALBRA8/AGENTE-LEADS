// ============================================================
// src/app/buscar/page.tsx — Buscar Clientes
// ============================================================

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SearchClient } from "@/components/offers/search-client";

export default async function BuscarPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  return (
    <AppShell>
      <div className="p-4 md:p-6 lg:p-8">
        <SearchClient />
      </div>
    </AppShell>
  );
}
