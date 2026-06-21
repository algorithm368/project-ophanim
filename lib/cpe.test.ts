import { describe, expect, it } from "vitest";
import { parseCpe, cpeLabel } from "./cpe";

describe("parseCpe", () => {
    it("parses the 2.2 URI form", () => {
        expect(parseCpe("cpe:/a:nginx:nginx:1.18.0")).toEqual({
            vendor: "nginx",
            product: "nginx",
            version: "1.18.0",
        });
    });

    it("parses the 2.3 formatted-string form, dropping wildcard tail fields", () => {
        expect(
            parseCpe("cpe:2.3:a:apache:http_server:2.4.41:*:*:*:*:*:*:*"),
        ).toEqual({
            vendor: "apache",
            product: "http server",
            version: "2.4.41",
        });
    });

    it("treats wildcard / not-applicable markers as absent", () => {
        expect(parseCpe("cpe:2.3:o:canonical:ubuntu_linux:-:*:*:*:*:*:*:*")).toEqual({
            vendor: "canonical",
            product: "ubuntu linux",
            version: undefined,
        });
    });

    it("yields all-undefined for a non-CPE string", () => {
        expect(parseCpe("not-a-cpe")).toEqual({
            vendor: undefined,
            product: undefined,
            version: undefined,
        });
    });
});

describe("cpeLabel", () => {
    it("uses the product name and version", () => {
        expect(cpeLabel("cpe:/a:nginx:nginx:1.18.0")).toEqual({
            name: "nginx",
            version: "1.18.0",
        });
    });

    it("omits the version when it is a wildcard", () => {
        expect(cpeLabel("cpe:2.3:o:canonical:ubuntu_linux:-:*:*:*:*:*:*:*")).toEqual({
            name: "ubuntu linux",
            version: undefined,
        });
    });

    it("falls back to the raw string when nothing parses", () => {
        expect(cpeLabel("garbage")).toEqual({ name: "garbage", version: undefined });
    });
});
