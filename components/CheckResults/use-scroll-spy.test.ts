import { describe, expect, it } from "vitest";
import { pickActiveId } from "./use-scroll-spy";

describe("pickActiveId", () => {
    it("returns null when there are no sections", () => {
        expect(pickActiveId([], 88)).toBeNull();
    });

    it("keeps the first section active before any crosses the line", () => {
        const sections = [
            { id: "origin", top: 200 },
            { id: "related", top: 600 },
        ];
        expect(pickActiveId(sections, 88)).toBe("origin");
    });

    it("activates the last section that has crossed the line", () => {
        const sections = [
            { id: "origin", top: -120 },
            { id: "related", top: 40 },
            { id: "research", top: 500 },
        ];
        expect(pickActiveId(sections, 88)).toBe("related");
    });

    it("activates the final section once every section has crossed", () => {
        const sections = [
            { id: "origin", top: -600 },
            { id: "related", top: -200 },
            { id: "sources", top: -40 },
        ];
        expect(pickActiveId(sections, 88)).toBe("sources");
    });

    it("treats a section exactly on the line as crossed", () => {
        const sections = [
            { id: "origin", top: -10 },
            { id: "related", top: 88 },
            { id: "research", top: 300 },
        ];
        expect(pickActiveId(sections, 88)).toBe("related");
    });
});
