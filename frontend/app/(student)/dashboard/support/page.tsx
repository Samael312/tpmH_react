"use client";

import ChipiWidget from "@/components/chipi/ChipiWidget";
import SupportTicketsView from "@/components/support/SupportTicketsView";
import { usePageTopBar } from "@/lib/mobileTopBar";

export default function StudentSupportPage() {
  usePageTopBar({ title: "Soporte" });

  return (
    <>
      <div className="min-h-screen bg-slate-50 relative overflow-hidden">
        <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
        <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-blue-300/15 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative">
          <SupportTicketsView />
        </div>
      </div>
      <ChipiWidget screenName="support_student" />
    </>
  );
}
