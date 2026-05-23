import Checker from "@/components/Checker";

export default function Home() {
  return (
    <main className="relative min-h-full overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-primary/8 via-primary/3 to-transparent"
      />
      <div className="relative">
        <Checker />
      </div>
    </main>
  );
}
