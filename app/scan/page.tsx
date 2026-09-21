import type { Metadata } from "next";
import { ScanSearch } from "@/components/ScanSearch";

export const metadata: Metadata = {
  title: "Active scan | Project Ophanim",
  description:
    "Visit an IP, domain, or URL through urlscan.io and Cloudflare, and read what it serves.",
};

/**
 * Active mode's landing page, the counterpart of the passive one at `/`.
 *
 * Having both means the mode is a place rather than a toggle inside a page: the
 * switch in the banner works before anything has been typed, and "the scanner"
 * is a link someone can be sent.
 */
export default function ScanHome() {
  return (
    <main className="relative min-h-full">
      <div className="mx-auto w-full max-w-7xl px-4 py-6">
        <ScanSearch />
      </div>
    </main>
  );
}
