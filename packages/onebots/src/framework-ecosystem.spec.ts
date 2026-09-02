import { describe, expect, it } from "vitest";
import { listFrameworkEcosystem } from "./framework-ecosystem.js";
import { listFrameworkProfiles } from "./framework-integration.js";

describe("framework ecosystem research catalog", () => {
    it("keeps researched candidates separate from plan-ready profiles", () => {
        const ecosystem = listFrameworkEcosystem();
        const readyIds = new Set(listFrameworkProfiles().map(profile => profile.id));

        expect(ecosystem).toHaveLength(11);
        expect(new Set(ecosystem.map(entry => entry.id))).toHaveLength(ecosystem.length);
        expect(ecosystem.every(entry => !readyIds.has(entry.id as never))).toBe(true);
        expect(ecosystem.filter(entry => entry.priority === "next")).toEqual([]);
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
    });
});
