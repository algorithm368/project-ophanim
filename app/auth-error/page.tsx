import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Not authorized · Project Ophanim",
};

/**
 * Where a refused sign-in lands. It names the reason, because an account that
 * is simply the wrong one is a five second fix once you know that is what
 * happened, and an unexplained bounce back to the sign-in button is not.
 */
export default function AuthErrorPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-md border border-border bg-background p-8">
        <h1 className="font-mono text-sm font-medium tracking-[0.14em] uppercase">
          Not authorized
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          That Google account is not on the organisation&apos;s Workspace
          domain, so it cannot sign in here. Try again with your work account.
        </p>
        <Button
          variant="outline"
          className="mt-6 w-full"
          render={<Link href="/sign-in" />}
        >
          Back to sign in
        </Button>
      </div>
    </main>
  );
}
