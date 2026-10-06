// ============================================================
// src/components/layout/app-shell.tsx — Main layout wrapper
// ============================================================

import { AppSidebar, MobileNav } from "./app-sidebar";
import { ChatWidget } from "@/components/dashboard/chat-widget";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex flex-1">
        <AppSidebar />
        <main className="flex-1 md:pl-64">
          <div className="min-h-screen flex flex-col">
            <div className="flex-1 pb-20 md:pb-0">{children}</div>
          </div>
        </main>
      </div>
      <MobileNav />
      <ChatWidget />
    </div>
  );
}
