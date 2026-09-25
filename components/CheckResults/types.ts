import type { ComponentType } from "react";
import type { LookupType } from "@/lib/ioc";

export type IconType = ComponentType<{ className?: string }>;

export type Mode = LookupType;
