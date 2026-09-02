import { describe, expect, it } from "vitest";
import { ApplicationRegistry } from "@onebots/core";
import { listFrameworkEcosystem } from "./framework-ecosystem.js";
import { listFrameworkProfiles } from "./framework-integration.js";

describe("framework ecosystem research catalog", () => {
    it("promotes every researched candidate into an activatable runtime profile", () => {
        const ecosystem = listFrameworkEcosystem();
        const readyIds = new Set(listFrameworkProfiles().map(profile => profile.id));

        expect(ecosystem).toHaveLength(11);
        expect(new Set(ecosystem.map(entry => entry.id))).toHaveLength(ecosystem.length);
        expect(ecosystem.every(entry => readyIds.has(entry.id))).toBe(true);
        expect(ecosystem.filter(entry => entry.priority === "next")).toEqual([]);
        expect(
            ecosystem.every(entry => ApplicationRegistry.get(entry.id)?.stage !== "planned"),
        ).toBe(true);
    });

    it("publishes immutable protocol evidence and explicit limitations", () => {
        const ecosystem = listFrameworkEcosystem();
        const olivos = ecosystem.find(entry => entry.id === "olivos");
        const avilla = ecosystem.find(entry => entry.id === "avilla");

        expect(olivos).toMatchObject({
            kind: "framework",
            protocols: ["onebot.v11", "onebot.v12"],
            priority: "later",
        });
        expect(avilla?.limitation).toContain("WIP");
        expect(ecosystem.every(entry => entry.evidence && entry.limitation)).toBe(true);
        expect(Object.isFrozen(ecosystem)).toBe(true);
        expect(Object.isFrozen(olivos?.protocols)).toBe(true);
        expect(avilla?.runtime).toMatchObject({ stage: "experimental", protocol: "satori.v1" });
        expect(ecosystem.find(entry => entry.id === "nonebot1")?.runtime.stage).toBe("legacy");
    });
});
