"use client";

import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Active mode: the trigger, on the page devoted to it.
 *
 * Every reading on /check is passive, assembled from records other people
 * already keep. This is the one control in the app that reaches out and touches
 * the indicator, so it lives here alone and is entered deliberately rather than
 * hit by reflex. Pressing it arms the scan; a second press fires it.
 *
 * The armed panel inverts to near-black because the skin spends color only on
 * the verdict, so inversion is the loudest signal left, and it cannot be read as
 * a threat level. It is also self-limiting: one inverted panel on a page reads
 * as a mode, two would read as decoration.
 */
export function ActiveModeButton({
  disabled,
  onClick,
}: Readonly<{ disabled?: boolean; onClick: () => void }>) {
  return (
    <Button type="button" size="sm" disabled={disabled} onClick={onClick}>
      <Radar />
      Active mode
    </Button>
  );
}

/** What the engage button says: mid-flight, a single target, or how many. */
function engageLabel(
  submitting: boolean | undefined,
  one: boolean,
  total: number,
): string {
  if (submitting) return "Engaging";
  return one ? "Engage" : `Engage all ${total}`;
}

export function ArmedPanel({
  targets,
  submitting,
  onEngage,
  onCancel,
}: Readonly<{
  targets: string[];
  submitting?: boolean;
  onEngage: () => void;
  onCancel: () => void;
}>) {
  const one = targets.length === 1;
  return (
    <div className="space-y-3 rounded-lg bg-foreground p-4 text-background">
      <p className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.16em] uppercase">
        <Radar className="size-3.5" />
        Active mode armed
      </p>

      {/* Two engines means the target is visited twice, by two third parties.
          That cost is stated here rather than implied, because it is the one
          thing the analyst cannot take back. */}
      <p className="text-sm text-background/80">
        This sends the following to urlscan.io and to Cloudflare. Each loads{" "}
        {one ? "it" : "them"} from its own infrastructure, so{" "}
        {one ? "the address is visited twice" : "every address is visited twice"}
        , by two third parties. Check the query string before continuing,
        phishing links often carry a token identifying the victim.
      </p>

      <ul className="space-y-1 rounded border border-background/25 bg-background/10 p-2">
        {targets.map((target) => (
          <li key={target} className="truncate font-mono text-xs">
            {target}
          </li>
        ))}
      </ul>

      <p className="text-xs text-background/65">
        Never submitted public. urlscan.io gets it private, so only this account
        can see the result, falling back to unlisted if the private quota for
        today is spent. Cloudflare offers no private tier, so unlisted is the
        tightest it takes.
      </p>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={submitting}
          onClick={onEngage}
          className="bg-background text-foreground hover:bg-background/85"
        >
          {engageLabel(submitting, one, targets.length)}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="text-background/70 hover:bg-background/15 hover:text-background"
        >
          Stand down
        </Button>
      </div>
    </div>
  );
}
