import type { Metadata } from "next";
import Checker from "@/components/Checker";

type Params = { params: Promise<{ ioc: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { ioc } = await params;
  const value = decodeURIComponent(ioc);
  return {
    title: `${value} | Project Ophanim`,
    description: `Threat-intelligence reputation for ${value}, checked across multiple sources.`,
  };
}

export default async function CheckPage({ params }: Params) {
  const { ioc } = await params;
  return (
    <main className="relative min-h-full overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-primary/8 via-primary/3 to-transparent"
      />
      <div className="relative">
        <Checker
          key={decodeURIComponent(ioc)}
          initialQuery={decodeURIComponent(ioc)}
        />
      </div>
    </main>
  );
}
