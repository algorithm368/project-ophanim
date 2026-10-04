import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  isBenignNetHost,
  isBenignRegKey,
  isPlaceholder,
  normalizeRegKey,
  sandboxCapabilities,
  sandboxMitre,
  sandboxRuntime,
  severityRank,
  virusTotalSandboxSource,
  type VtBehaviourSummary,
} from "./virustotal-sandbox";
import * as http from "../../http";

const SHA = "e".repeat(64);

describe("severityRank", () => {
  it("orders VT severities high to low, unknown lowest", () => {
    expect(severityRank("IMPACT_SEVERITY_CRITICAL")).toBeGreaterThan(
      severityRank("IMPACT_SEVERITY_HIGH"),
    );
    expect(severityRank("IMPACT_SEVERITY_MEDIUM")).toBeGreaterThan(
      severityRank("IMPACT_SEVERITY_INFO"),
    );
    expect(severityRank(undefined)).toBe(0);
  });
});

describe("sandboxCapabilities", () => {
  const data: VtBehaviourSummary["data"] = {
    signature_matches: [
      { id: "0", name: "terminate process" },
      { id: "1", name: "query or enumerate registry value" },
      { id: "2", name: "terminate process" }, // duplicate name -> dropped
    ],
    mitre_attack_techniques: [
      { id: "T1489", refs: [{ ref: "#signature_matches", value: "0" }] },
      { id: "T1012", refs: [{ ref: "#signature_matches", value: "1" }] },
    ],
  };

  it("maps signature names to capabilities tagged with the citing technique", () => {
    expect(sandboxCapabilities(data)).toEqual([
      { label: "terminate process", mitre: ["T1489"] },
      { label: "query or enumerate registry value", mitre: ["T1012"] },
    ]);
  });

  it("omits mitre when no technique references the signature", () => {
    expect(
      sandboxCapabilities({ signature_matches: [{ id: "9", name: "do a thing" }] }),
    ).toEqual([{ label: "do a thing" }]);
  });

  it("returns empty when there are no signature matches", () => {
    expect(sandboxCapabilities({})).toEqual([]);
    expect(sandboxCapabilities(undefined)).toEqual([]);
  });
});

describe("sandboxMitre", () => {
  it("dedupes by id keeping the highest severity, ranks, and caps", () => {
    const data: VtBehaviourSummary["data"] = {
      mitre_attack_techniques: [
        { id: "T1", severity: "IMPACT_SEVERITY_INFO", signature_description: "low one" },
        { id: "T1", severity: "IMPACT_SEVERITY_HIGH", signature_description: "high one" },
        { id: "T2", severity: "IMPACT_SEVERITY_MEDIUM", signature_description: "mid" },
      ],
    };
    expect(sandboxMitre(data, 12)).toEqual([
      { id: "T1", name: "high one" },
      { id: "T2", name: "mid" },
    ]);
  });

  it("caps to the requested count after ranking", () => {
    const data: VtBehaviourSummary["data"] = {
      mitre_attack_techniques: Array.from({ length: 20 }, (_, i) => ({
        id: `T${i}`,
        severity: "IMPACT_SEVERITY_INFO",
      })),
    };
    expect(sandboxMitre(data, 12)).toHaveLength(12);
  });

  it("returns empty when no techniques", () => {
    expect(sandboxMitre({})).toEqual([]);
  });
});

describe("isPlaceholder", () => {
  it("drops placeholder-only strings, keeps real content with a placeholder", () => {
    expect(isPlaceholder("%SAMPLEPATH%")).toBe(true);
    expect(isPlaceholder("<CURRENT_DIR>")).toBe(true);
    expect(isPlaceholder("<HKLM>")).toBe(true);
    expect(isPlaceholder("%TEMP%\\taskdl.exe")).toBe(false);
    expect(isPlaceholder("taskdl.exe")).toBe(false);
  });
});

describe("normalizeRegKey", () => {
  it("collapses hive placeholders and long HKEY_* names, keeping the key only", () => {
    expect(normalizeRegKey("<HKLM>\\Software\\WanaCrypt0r\\wd")).toBe(
      "HKLM\\Software\\WanaCrypt0r\\wd",
    );
    expect(
      normalizeRegKey("HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\WanaCrypt0r\\wd"),
    ).toBe("HKLM\\SOFTWARE\\WOW6432Node\\WanaCrypt0r\\wd");
    expect(normalizeRegKey("<HKCU>\\Control Panel\\Desktop\\Wallpaper")).toBe(
      "HKCU\\Control Panel\\Desktop\\Wallpaper",
    );
    expect(normalizeRegKey(undefined)).toBeUndefined();
  });

  it("flags ubiquitous shell-folder keys as benign noise", () => {
    expect(
      isBenignRegKey(
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders\\Personal",
      ),
    ).toBe(true);
    expect(isBenignRegKey("HKLM\\Software\\WanaCrypt0r\\wd")).toBe(false);
  });
});

describe("sandboxRuntime", () => {
  it("groups, dedupes, cleans placeholders, and normalizes registry keys", () => {
    const data: VtBehaviourSummary["data"] = {
      command_executions: ["%SAMPLEPATH%", "taskdl.exe", "taskdl.exe"],
      processes_created: ["cmd.exe /c vssadmin delete shadows"],
      files_dropped: [{ path: "%TEMP%\\a.exe" }],
      files_written: ["C:\\b.dll"],
      registry_keys_set: [
        { key: "<HKLM>\\Software\\Run\\x", value: "C:\\a.exe" },
        { key: "HKEY_LOCAL_MACHINE\\Software\\Run\\y", value: "x".repeat(100) },
        // Benign shell-folder noise, dropped.
        { key: "<HKCU>\\...\\Explorer\\Shell Folders\\Personal", value: "C:\\Docs" },
      ],
      // github/microsoft are benign sandbox noise and get dropped.
      dns_lookups: [{ hostname: "evil.example" }, { hostname: "github.com" }],
      ip_traffic: [{ destination_ip: "1.2.3.4", destination_port: 445 }],
      memory_pattern_urls: ["http://evil.onion", "https://schemas.microsoft.com/x"],
    };
    expect(sandboxRuntime(data)).toEqual({
      commands: ["taskdl.exe", "cmd.exe /c vssadmin delete shadows"],
      files: ["%TEMP%\\a.exe", "C:\\b.dll"],
      registry: ["HKLM\\Software\\Run\\x", "HKLM\\Software\\Run\\y"],
      network: ["url http://evil.onion", "ip 1.2.3.4:445", "dns evil.example"],
    });
  });

  it("filters benign OS/CDN/library hosts, keeps real C2 hosts", () => {
    expect(isBenignNetHost("https://github.com/python/cpython")).toBe(true);
    expect(isBenignNetHost("schemas.microsoft.com")).toBe(true);
    expect(isBenignNetHost("res.public.onecdn.static.microsoft")).toBe(true);
    expect(isBenignNetHost("dns.google")).toBe(true);
    expect(isBenignNetHost("bg.microsoft.map.fastly.net")).toBe(true);
    expect(isBenignNetHost("cwwnhwhlz52maqm7.onion")).toBe(false);
    expect(isBenignNetHost("evil-c2.example")).toBe(false);
    expect(isBenignNetHost(undefined)).toBe(false);
  });

  // The host list used to be one alternation with optional groups:
  // microsoft(\.com)?, google(\.com)?, cloudflare(-dns)?\.com,
  // akamai(edge|technologies)?\.net, edge(key|suite)\.net and
  // (global)?g?cdn\.co. Expanding those by hand is the part that could have
  // dropped a domain, so every variant they generated is pinned here.
  it("keeps every domain the old optional groups expanded to", () => {
    for (const host of [
      "microsoft",
      "microsoft.com",
      "google",
      "google.com",
      "cloudflare.com",
      "cloudflare-dns.com",
      "akamai.net",
      "akamaiedge.net",
      "akamaitechnologies.net",
      "edgekey.net",
      "edgesuite.net",
      "cdn.co",
      "gcdn.co",
      "globalcdn.co",
      "globalgcdn.co",
    ]) {
      expect(isBenignNetHost(host), host).toBe(true);
      expect(isBenignNetHost(`sub.${host}`), `sub.${host}`).toBe(true);
    }
  });

  // A benign domain as a *prefix* is not a benign host: the old regex anchored
  // each alternative with (^|\.) and $, and the parent-walk has to match that.
  it("does not match a benign domain used as a prefix or lookalike", () => {
    expect(isBenignNetHost("microsoft.com.evil.tld")).toBe(false);
    expect(isBenignNetHost("notmicrosoft.com")).toBe(false);
    expect(isBenignNetHost("xcdn.co")).toBe(false);
    expect(isBenignNetHost("akamai.com")).toBe(false);
  });

  it("caps each group at 8", () => {
    const data: VtBehaviourSummary["data"] = {
      command_executions: Array.from({ length: 20 }, (_, i) => `cmd${i}`),
    };
    expect(sandboxRuntime(data)?.commands).toHaveLength(8);
  });

  it("returns undefined when every group is empty", () => {
    expect(sandboxRuntime({})).toBeUndefined();
    expect(sandboxRuntime(undefined)).toBeUndefined();
  });
});

describe("virusTotalSandboxSource.check", () => {
  const prev = process.env.VIRUSTOTAL_API_KEY;
  beforeEach(() => {
    process.env.VIRUSTOTAL_API_KEY = "test-key";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.VIRUSTOTAL_API_KEY;
    else process.env.VIRUSTOTAL_API_KEY = prev;
    vi.restoreAllMocks();
  });

  it("skips without a key", async () => {
    delete process.env.VIRUSTOTAL_API_KEY;
    const f = await virusTotalSandboxSource.check(SHA, new AbortController().signal);
    expect(f.status).toBe("skipped");
  });

  it("treats 404 as ok with no data (file has no sandbox report)", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: false,
      status: 404,
      data: {},
    } as never);
    const f = await virusTotalSandboxSource.check(SHA, new AbortController().signal);
    expect(f.status).toBe("ok");
    expect(f.hashContext).toBeUndefined();
  });

  it("treats a 2xx with an empty body as ok, not an error (e.g. archives)", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {}, // no data.data
    } as never);
    const f = await virusTotalSandboxSource.check(SHA, new AbortController().signal);
    expect(f.status).toBe("ok");
    expect(f.summary).toBe("No sandbox behaviour report");
    expect(f.hashContext).toBeUndefined();
  });

  it("errors on non-ok, non-404 responses", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: false,
      status: 401,
      data: { error: { message: "Wrong key" } },
    } as never);
    const f = await virusTotalSandboxSource.check(SHA, new AbortController().signal);
    expect(f.status).toBe("error");
    expect(f.error).toBe("Wrong key");
  });

  it("emits capabilities, techniques, and runtime behavior on success", async () => {
    vi.spyOn(http, "getJson").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          tags: ["PERSISTENCE", "CRYPTO", "PERSISTENCE"],
          signature_matches: [{ id: "0", name: "terminate process" }],
          mitre_attack_techniques: [
            {
              id: "T1489",
              severity: "IMPACT_SEVERITY_MEDIUM",
              signature_description: "terminate process",
              refs: [{ ref: "#signature_matches", value: "0" }],
            },
          ],
          command_executions: ["cmd.exe /c vssadmin delete shadows"],
          registry_keys_set: [{ key: "HKLM\\...\\Run\\x" }],
        },
      },
    } as never);
    const f = await virusTotalSandboxSource.check(SHA, new AbortController().signal);
    expect(f.status).toBe("ok");
    expect(f.score).toBeUndefined(); // context-only, never scores
    expect(f.hashContext?.capabilities).toEqual([
      { label: "terminate process", mitre: ["T1489"] },
    ]);
    expect(f.hashContext?.mitreTechniques).toEqual([
      { id: "T1489", name: "terminate process" },
    ]);
    expect(f.hashContext?.sandboxBehavior?.commands).toEqual([
      "cmd.exe /c vssadmin delete shadows",
    ]);
    expect(f.hashContext?.sandboxBehavior?.registry).toEqual(["HKLM\\...\\Run\\x"]);
    expect(f.hashContext?.behaviorTags).toEqual(["PERSISTENCE", "CRYPTO"]);
  });
});

describe("sandboxRuntime — ip_traffic shapes", () => {
  it("omits the port when the sandbox did not record one", () => {
    const runtime = sandboxRuntime({
      ip_traffic: [{ destination_ip: "1.2.3.4" }],
    } as never);
    expect(runtime?.network).toContain("ip 1.2.3.4");
  });

  // A row with no destination address is not a contact anyone can pivot on,
  // so it is dropped rather than rendered as a bare port.
  it("drops a row with no destination address", () => {
    const runtime = sandboxRuntime({
      ip_traffic: [{ destination_port: 443 }, { destination_ip: "9.9.9.9" }],
    } as never);
    const ips = (runtime?.network ?? []).filter((n) => n.startsWith("ip "));
    expect(ips).toEqual(["ip 9.9.9.9"]);
  });
});

describe("virustotal-sandbox helpers — edge cases", () => {
  it("ranks a low severity above info", () => {
    expect(severityRank("IMPACT_SEVERITY_LOW")).toBe(2);
  });

  it("reads an all-whitespace registry key as no key", () => {
    expect(normalizeRegKey("   ")).toBeUndefined();
  });

  it("links techniques to signatures defensively", () => {
    const b: VtBehaviourSummary["data"] = {
      signature_matches: [
        { id: "0", name: "Alpha" },
        { name: "  " },
        { name: "alpha" },
        { name: "Beta" },
        { id: "9", name: "Gamma" },
      ],
      mitre_attack_techniques: [
        { refs: [{ ref: "#signature_matches", value: "0" }] },
        { id: "T1", refs: [{ ref: "#other", value: "0" }, { ref: "#signature_matches" }] },
        {
          id: "T2",
          refs: [
            { ref: "#signature_matches", value: "0" },
            { ref: "#signature_matches", value: "0" },
          ],
        },
        { id: "T3" },
      ],
    };
    expect(sandboxCapabilities(b)).toEqual([
      { label: "Alpha", mitre: ["T2"] },
      { label: "Beta" },
      { label: "Gamma" },
    ]);
    expect(sandboxCapabilities(b, 1)).toEqual([{ label: "Alpha", mitre: ["T2"] }]);
  });

  it("keeps the more severe of two entries for one technique, whichever comes first", () => {
    expect(
      sandboxMitre({
        mitre_attack_techniques: [
          { id: "T1", severity: "IMPACT_SEVERITY_HIGH", signature_description: "hi" },
          { id: "T1", severity: "IMPACT_SEVERITY_LOW", signature_description: "lo" },
          { id: "T2", signature_description: " " },
        ],
      }),
    ).toEqual([
      { id: "T1", name: "hi" },
      { id: "T2", name: undefined },
    ]);
  });
});

describe("virusTotalSandboxSource.check — remaining paths", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.spyOn(http, "getJson").mockResolvedValue({ ok: status < 400, status, data, text: "" } as never);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports whether a key is configured", () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "");
    expect(virusTotalSandboxSource.isEnabled()).toBe(false);
    vi.stubEnv("VIRUSTOTAL_API_KEY", "k");
    expect(virusTotalSandboxSource.isEnabled()).toBe(true);
  });

  it("summarizes runtime-only behaviour, with tags", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "k");
    reply({ data: { command_executions: ["cmd /c whoami"], tags: ["PERSISTENCE"] } });
    const f = await virusTotalSandboxSource.check(SHA, signal);
    expect(f.summary).toBe("Sandbox: 0 behaviours, 0 techniques");
    expect(f.hashContext).toMatchObject({
      capabilities: undefined,
      mitreTechniques: undefined,
      behaviorTags: ["PERSISTENCE"],
    });
  });

  it("calls a report with nothing readable no report", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "k");
    reply({ data: { mitre_attack_techniques: [{}], signature_matches: [{}] } });
    const f = await virusTotalSandboxSource.check(SHA, signal);
    expect(f.summary).toBe("No sandbox behaviour report");
    expect(f.hashContext?.behaviorTags).toBeUndefined();
  });

  it("surfaces an API error message, timeouts and errors", async () => {
    vi.stubEnv("VIRUSTOTAL_API_KEY", "k");
    reply({ error: { message: "Quota exceeded" } }, 429);
    expect((await virusTotalSandboxSource.check(SHA, signal)).error).toBe("Quota exceeded");
    vi.restoreAllMocks();
    reply(null, 500);
    expect((await virusTotalSandboxSource.check(SHA, signal)).error).toBe("HTTP 500");
    vi.restoreAllMocks();
    reply({}, 500);
    expect((await virusTotalSandboxSource.check(SHA, signal)).error).toBe("HTTP 500");
    vi.restoreAllMocks();
    vi.spyOn(http, "getJson").mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await virusTotalSandboxSource.check(SHA, signal)).status).toBe("timeout");
    vi.restoreAllMocks();
    vi.spyOn(http, "getJson").mockRejectedValue(new Error("boom"));
    expect((await virusTotalSandboxSource.check(SHA, signal)).error).toBe("boom");
  });
});
