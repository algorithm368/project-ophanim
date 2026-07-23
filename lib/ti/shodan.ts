import type { SourceResult } from "./types";

/** Common TCP ports -> service label, for the exposed-services view. */
export const PORT_SERVICE: Record<number, string> = {
    21: "FTP",
    22: "SSH",
    23: "Telnet",
    25: "SMTP",
    53: "DNS",
    80: "HTTP",
    110: "POP3",
    111: "RPC",
    123: "NTP",
    135: "MSRPC",
    139: "NetBIOS",
    143: "IMAP",
    161: "SNMP",
    389: "LDAP",
    443: "HTTPS",
    445: "SMB",
    465: "SMTPS",
    587: "SMTP",
    993: "IMAPS",
    995: "POP3S",
    1433: "MSSQL",
    1521: "Oracle",
    2049: "NFS",
    2375: "Docker",
    3306: "MySQL",
    3389: "RDP",
    5432: "Postgres",
    5900: "VNC",
    5985: "WinRM",
    6379: "Redis",
    8080: "HTTP-alt",
    8443: "HTTPS-alt",
    9200: "Elasticsearch",
    11211: "Memcached",
    27017: "MongoDB",
};

export type ShodanHostInfo = {
    ports: number[];
    vulns: string[];
    cpes: string[];
    hostnames: string[];
};

/** Pull host-exposure details out of the Shodan InternetDB source result. */
export function shodanHostInfo(sources: SourceResult[]): ShodanHostInfo {
    const d = (sources.find((s) => s.source.id === "shodan-internetdb")
        ?.details ?? {}) as Record<string, unknown>;
    const strs = (v: unknown): string[] =>
        Array.isArray(v)
            ? v.filter((x): x is string => typeof x === "string")
            : [];
    const nums = (v: unknown): number[] =>
        Array.isArray(v)
            ? v.filter((x): x is number => typeof x === "number")
            : [];
    return {
        ports: nums(d.ports),
        vulns: strs(d.vulns),
        cpes: strs(d.cpes),
        hostnames: strs(d.hostnames),
    };
}
