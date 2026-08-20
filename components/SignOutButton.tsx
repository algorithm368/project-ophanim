import { LogOut } from "lucide-react";
import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";

/**
 * A way out, beside the controls for how the page is shown.
 *
 * An async server component, so it renders nothing at all when signed out
 * rather than flashing a control that would not work. It is icon-only at this
 * size for the same reason the mode switch hides its words on a phone; the
 * accessible name is stated outright instead of left to a tooltip.
 */
export async function SignOutButton() {
  const session = await auth();
  if (!session?.user) return null;

  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/sign-in" });
      }}
    >
      <Button type="submit" variant="outline" size="icon" aria-label="Sign out">
        <LogOut />
      </Button>
    </form>
  );
}
