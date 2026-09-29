"use client";

import { flagUrl } from "@/lib/flag";
import type { NetType } from "@/lib/ti/geo/table";

export function Flag({ code }: Readonly<{ code: string | undefined }>) {
  const src = flagUrl(code);
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny external flag asset; next/image is overkill here
    <img
      src={src}
      alt=""
      width={20}
      height={14}
      loading="lazy"
      className="h-3.5 w-5 shrink-0 rounded-[2px] border border-foreground/20 object-cover"
    />
  );
}

/** Network kinds as flat grey tags. Grey on purpose: colour on this page
 *  belongs to verdicts, and "hosting" is a fact, not a finding. */
export function TypeTags({ types }: Readonly<{ types: NetType[] }>) {
  if (!types.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {types.map((t) => (
        <span
          key={t}
          className="rounded-sm border border-foreground/25 px-1.5 py-px font-mono text-[10px] tracking-wide text-muted-foreground uppercase"
        >
          {t}
        </span>
      ))}
    </span>
  );
}
