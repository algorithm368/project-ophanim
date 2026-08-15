import type { ComponentType } from "react";

export type IconType = ComponentType<{ className?: string }>;

export type Mode = "ip" | "domain" | "hash" | "url";
