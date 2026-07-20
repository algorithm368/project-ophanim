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
