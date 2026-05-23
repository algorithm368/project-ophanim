"use client";

import { useState, type ComponentType } from "react";
import {
  Activity,
  Ban,
  Building2,
  Check,
  CircleX,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  Network,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  SignalHigh,
  TriangleAlert,
} from "lucide-react";
import type {
  CheckResult,
  GeoContext,
  SourceResult,
  Verdict,
} from "@/lib/ti/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

type VerdictStyle = {
  label: string;
  blurb: string;
  icon: ComponentType<{ className?: string }>;
  text: string;
  bar: string;
  ring: string;
  chip: string;
};

const VERDICT_STYLE: Record<Verdict, VerdictStyle> = {
  malicious: {
    label: "Malicious",
    blurb: "Strong signals of malicious activity — treat this address as dangerous.",
    icon: ShieldAlert,
    text: "text-red-600 dark:text-red-400",
    bar: "bg-red-500",
    ring: "stroke-red-500",
    chip: "border-transparent bg-red-500/12 text-red-600 dark:text-red-400",
  },
  suspicious: {
    label: "Suspicious",
    blurb: "Some sources flagged this address — investigate before trusting it.",
    icon: ShieldAlert,
    text: "text-orange-600 dark:text-orange-400",
    bar: "bg-orange-500",
    ring: "stroke-orange-500",
    chip: "border-transparent bg-orange-500/12 text-orange-600 dark:text-orange-400",
  },
  low: {
    label: "Low risk",
    blurb: "Only minor signals — likely safe, but worth a quick glance.",
    icon: ShieldQuestion,
    text: "text-amber-600 dark:text-amber-400",
    bar: "bg-amber-500",
    ring: "stroke-amber-500",
    chip: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  clean: {
    label: "Clean",
    blurb: "No threat-intel source flagged this address.",
    icon: ShieldCheck,
    text: "text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500",
    ring: "stroke-emerald-500",
    chip: "border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  },
  unknown: {
    label: "Unknown",
    blurb: "Not enough data to judge this address.",
    icon: ShieldQuestion,
    text: "text-muted-foreground",
    bar: "bg-muted-foreground",
    ring: "stroke-muted-foreground",
    chip: "border-transparent bg-muted text-muted-foreground",
  },
};

function scoreBarColor(score: number): string {
  if (score >= 70) return "bg-red-500";
  if (score >= 40) return "bg-orange-500";
  if (score >= 15) return "bg-amber-500";
  return "bg-emerald-500";
}

const CATEGORY_LABEL: Record<string, string> = {
  reputation: "Reputation",
  blocklist: "Blocklist",
  scanner: "Scanner",
  dnsbl: "DNSBL",
  context: "Context",
};

const EXAMPLES = ["8.8.8.8", "1.1.1.1", "185.220.101.1"];

export default function Checker() {
  const [ip, setIp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  async function runCheck(target: string) {
    const value = target.trim();
    if (!value || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
      } else {
        setResult(data as CheckResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="size-6" />
          </span>
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              IP Threat Intelligence
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Check any IPv4 address across multiple sources, get one clear verdict.
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runCheck(ip);
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            inputMode="numeric"
            placeholder="Enter an IPv4 address, e.g. 8.8.8.8"
            className="h-12 rounded-xl pl-10 font-mono text-base shadow-sm"
          />
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={loading || !ip.trim()}
          className="h-12 rounded-xl px-7 text-base shadow-sm hover:bg-primary/90"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Checking…
            </>
          ) : (
            <>
              <Search className="size-4" />
              Check IP
            </>
          )}
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Try one of these:</span>
        {EXAMPLES.map((s) => (
          <Button
            key={s}
            type="button"
            variant="outline"
            size="xs"
            className="rounded-full font-mono"
            onClick={() => {
              setIp(s);
              runCheck(s);
            }}
          >
            {s}
          </Button>
        ))}
      </div>

      {error && (
        <div className="mt-8 flex items-center gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          <TriangleAlert className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && <LoadingSkeleton />}

      {!loading && !error && !result && <EmptyState />}

      {!loading && result && <Results result={result} />}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="mt-10 border-dashed bg-card/50">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <ShieldQuestion className="size-6" />
        </span>
        <div className="space-y-1">
          <p className="font-heading text-base font-medium">
            Ready when you are
          </p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Enter an IPv4 address above to scan it against reputation feeds,
            blocklists, scanners, and DNS blocklists — all results summarized into
            a single risk score.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mt-8 space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="size-28 shrink-0 animate-pulse self-center rounded-full bg-muted sm:self-auto" />
          <div className="flex-1 space-y-3">
            <div className="h-5 w-24 animate-pulse rounded-md bg-muted" />
            <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded-md bg-muted" />
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3">
              <div className="h-4 w-32 animate-pulse rounded-md bg-muted" />
              <div className="h-2 w-full animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-3/4 animate-pulse rounded-md bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Results({ result }: { result: CheckResult }) {
  return (
    <div className="mt-8 space-y-6 duration-500 animate-in fade-in slide-in-from-bottom-2">
      <VerdictCard result={result} />
      {result.geo && <GeoCard geo={result.geo} />}
      <div className="space-y-3">
        <h2 className="px-1 text-sm font-medium text-muted-foreground">
          Source breakdown
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {result.sources.map((s) => (
            <SourceCard key={s.source.id} result={s} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ScoreRing({ value, stroke }: { value: number; stroke: string }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <svg viewBox="0 0 120 120" className="size-full -rotate-90">
      <circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        strokeWidth="9"
        className="stroke-foreground/10"
      />
      <circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className={cn(
          "transition-[stroke-dashoffset] duration-700 ease-out",
          stroke,
        )}
      />
    </svg>
  );
}

function VerdictCard({ result }: { result: CheckResult }) {
  const style = VERDICT_STYLE[result.verdict];
  const Icon = style.icon;

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative size-28 shrink-0 self-center sm:self-auto">
            <ScoreRing value={result.riskScore} stroke={style.ring} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className={cn(
                  "text-3xl font-bold tabular-nums leading-none",
                  style.text,
                )}
              >
                {result.riskScore}
              </span>
              <span className="mt-1 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                / 100
              </span>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-2.5">
            <Badge className={cn("gap-1.5", style.chip)}>
              <Icon className="size-3.5" />
              {style.label}
            </Badge>
            <CopyableIp ip={result.ip} />
            <p className="text-sm leading-relaxed text-foreground/80">
              {style.blurb}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3" />
              Checked {new Date(result.checkedAt).toLocaleString()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            icon={Activity}
            label="Sources checked"
            value={result.stats.queried}
          />
          <StatTile
            icon={TriangleAlert}
            label="Flagged"
            value={result.stats.flagged}
            accent={result.stats.flagged > 0 ? "bad" : undefined}
          />
          <StatTile
            icon={CircleX}
            label="Errors"
            value={result.stats.errored}
          />
          <StatTile
            icon={Ban}
            label="No key"
            value={result.stats.skipped}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CopyableIp({ ip }: { ip: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xl font-medium tracking-tight">{ip}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Copy IP address"
        onClick={() => {
          navigator.clipboard?.writeText(ip).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Copy className="size-3.5 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
  accent?: "bad";
}) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums",
          accent === "bad"
            ? "text-red-600 dark:text-red-400"
            : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function GeoCard({ geo }: { geo: GeoContext }) {
  const rows: {
    icon: ComponentType<{ className?: string }>;
    label: string;
    value?: string;
  }[] = [
    {
      icon: MapPin,
      label: "Location",
      value: [geo.city, geo.region, geo.country].filter(Boolean).join(", "),
    },
    { icon: Network, label: "ASN", value: geo.asn },
    { icon: Building2, label: "ISP / Org", value: geo.isp ?? geo.org },
    { icon: SignalHigh, label: "Reverse DNS", value: geo.reverse },
  ];
  const flags: { icon: ComponentType<{ className?: string }>; label: string }[] =
    [];
  if (geo.isProxy) flags.push({ icon: ShieldAlert, label: "Proxy / VPN / Tor" });
  if (geo.isHosting) flags.push({ icon: Server, label: "Hosting / Datacenter" });
  if (geo.isMobile) flags.push({ icon: SignalHigh, label: "Mobile network" });

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          <h2 className="font-heading text-base font-medium">Network context</h2>
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {rows
            .filter((r) => r.value)
            .map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-start gap-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="truncate font-mono text-sm text-foreground">
                    {value}
                  </dd>
                </div>
              </div>
            ))}
        </dl>
        {flags.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {flags.map((f) => (
              <Badge
                key={f.label}
                className="gap-1.5 border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400"
              >
                <f.icon className="size-3.5" />
                {f.label}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SourceCard({ result }: { result: SourceResult }) {
  const { source, status } = result;
  const skipped = status === "skipped";
  const errored = status === "error" || status === "timeout";
  const score = result.score;

  return (
    <Card
      className={cn(
        "transition-all hover:ring-foreground/20",
        skipped && "opacity-65",
      )}
    >
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-1 font-heading text-sm font-semibold hover:text-primary"
            >
              {source.name}
              <ExternalLink className="size-3 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            </a>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Badge variant="secondary" className="px-1.5 font-normal">
                {CATEGORY_LABEL[source.category] ?? source.category}
              </Badge>
              {result.durationMs > 0 && (
                <span className="tabular-nums">{result.durationMs} ms</span>
              )}
            </div>
          </div>
          <StatusPill result={result} />
        </div>

        {!skipped && typeof score === "number" && (
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/10">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  scoreBarColor(score),
                )}
                style={{ width: `${Math.max(score, 1)}%` }}
              />
            </div>
            <span className="w-9 text-right text-xs font-semibold tabular-nums text-muted-foreground">
              {score}
            </span>
          </div>
        )}

        <p
          className={cn(
            "text-sm leading-relaxed",
            errored ? "text-destructive" : "text-foreground/85",
          )}
        >
          {errored
            ? (result.error ?? "Lookup failed")
            : (result.summary ??
              (skipped
                ? source.keyEnv
                  ? `Set ${source.keyEnv} to enable this source.`
                  : "Disabled."
                : "No data."))}
        </p>

        {result.categories && result.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {result.categories.slice(0, 8).map((c, i) => (
              <Badge key={`${c}-${i}`} variant="outline" className="font-normal">
                {c}
              </Badge>
            ))}
          </div>
        )}

        {result.details && Object.keys(result.details).length > 0 && (
          <details className="group/details text-xs">
            <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground select-none hover:text-foreground">
              <ExternalLink className="size-3" />
              View raw details
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
              {JSON.stringify(result.details, null, 2)}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({ result }: { result: SourceResult }) {
  const { status } = result;
  const flagged =
    status === "ok" && (result.malicious || (result.score ?? 0) >= 40);

  if (flagged) {
    return (
      <Badge className="gap-1 border-transparent bg-red-500/12 text-red-600 dark:text-red-400">
        <TriangleAlert className="size-3" />
        Flagged
      </Badge>
    );
  }

  switch (status) {
    case "ok":
      return (
        <Badge className="gap-1 border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="size-3" />
          Clean
        </Badge>
      );
    case "error":
    case "timeout":
      return (
        <Badge variant="destructive" className="gap-1">
          <CircleX className="size-3" />
          {status === "timeout" ? "Timeout" : "Error"}
        </Badge>
      );
    default:
      return <Badge variant="outline">No key</Badge>;
  }
}
