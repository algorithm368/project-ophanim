import type { Metadata } from "next";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Sign in · Project Ophanim",
};

/**
 * One provider, so one button and no list to choose from.
 *
 * A server component with a server action rather than a client handler: the
 * page is static except for the submit, so there is nothing for a client
 * bundle to do here.
 */
export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-md border border-border bg-background p-8">
        <h1 className="font-mono text-sm font-medium tracking-[0.14em] uppercase">
          Sign in
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This tool is limited to accounts on the organisation&apos;s Google
          Workspace domain.
        </p>
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <Button type="submit" className="w-full">
            Continue with Google
          </Button>
        </form>
      </div>
    </main>
  );
}
