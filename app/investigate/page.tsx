import type { Metadata } from "next";
import { InvestigateView } from "@/components/InvestigateView";

export const metadata: Metadata = {
  title: "Investigate | Project Ophanim",
  description:
    "Build a visual investigation graph by checking multiple IOCs and following their relationships.",
};

export default function InvestigatePage() {
  return (
    <main className="relative min-h-full overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-primary/8 via-primary/3 to-transparent"
      />
      <div className="relative">
        <InvestigateView />
      </div>
    </main>
  );
}
