import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Sign in · Project Ophanim",
};

/**
 * One provider, so one button and no list to choose from.
 *
 * A server component with a server action rather than a client handler: there
 * is nothing for a client bundle to do here.
 *
 * proxy.ts cannot gate this path, or it would redirect the sign-in page to
 * itself, so the "already signed in" case is handled here instead. Without it
 * a signed-in visitor who lands on /sign-in (a stale tab, a bookmark, the Back
 * button) is offered a door they are already through.
 *
 * The redirect goes home rather than to `callbackUrl`. That parameter is
 * attacker-controllable, and sending a signed-in user wherever it points is an
 * open redirect; Auth.js validates it during a real sign-in, but nothing
 * validates it here.
 */
export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/");

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
