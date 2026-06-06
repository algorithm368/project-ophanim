import { describe, expect, it } from "vitest";
import { feodoFinding } from "./feodo";

describe("feodoFinding", () => {
  it("maps a C2 hit to a malicious botnet finding", () => {
    const f = feodoFinding({
      ip_address: "1.2.3.4",
      malware: "Emotet",
      status: "online",
      last_online: "2024-01-01",
      port: 443,
    });
    expect(f.malicious).toBe(true);
    expect(f.score).toBe(95);
    expect(f.categories).toEqual(["botnet-c2", "Emotet"]);
    expect(f.summary).toBe("Known Emotet C2 (status: online)");
    expect(f.lastSeen).toBe("2024-01-01");
  });

  it("falls back to generic labels when malware/status are missing", () => {
    const f = feodoFinding({ ip_address: "9.9.9.9" });
    expect(f.categories).toEqual(["botnet-c2", "malware"]);
    expect(f.summary).toBe("Known malware C2 (status: unknown)");
  });
});
