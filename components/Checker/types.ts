import type { ComponentType } from "react";
import type { IOCType } from "@/lib/ioc";
import type { SourceMeta, SourceResult } from "@/lib/ti/types";

export type IconType = ComponentType<{ className?: string }>;

/** Which checker is active. An alias rather than a second union of the same
 *  four strings: it was written out longhand here and stayed accidentally in
 *  step with `IOCType` through four IOC kinds, which is four chances it had to
 *  stop being. */
export type Mode = IOCType;

/** "input" = bad/unsupported value the user typed; "request" = lookup failed. */
export type CheckError = { kind: "input" | "request"; message: string };

/** Live state of an in-flight check, driven by the NDJSON progress stream. */
export type Progress = {
  total: number;
  metas: SourceMeta[];
  settled: Record<string, SourceResult>;
};
