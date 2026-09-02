import { describe, expect, it } from "vitest";
import { listFrameworkEcosystem } from "./framework-ecosystem.js";
import { listFrameworkProfiles } from "./framework-integration.js";

describe("framework ecosystem research catalog", () => {
    it("keeps researched candidates separate from plan-ready profiles", () => {
        const ecosystem = listFrameworkEcosystem();
        const readyIds = new Set(listFrameworkProfiles().map(profile => profile.id));

        expect(ecosystem).toHaveLength(18);
        expect(new Set(ecosystem.map(entry => entry.id))).toHaveLength(ecosystem.length);
        expect(ecosystem.every(entry => !readyIds.has(entry.id as never))).toBe(true);
        expect(ecosystem.filter(entry => entry.priority === "next").map(entry => entry.id)).toEqual(
            ["astrbot", "langbot", "alicebot", "melobot", "kovi", "zerobot", "kotori"],
        );
    });

    it("publishes immutable protocol evidence and explicit limitations", () => {
        const ecosystem = listFrameworkEcosystem();
        const kovi = ecosystem.find(entry => entry.id === "kovi");
        const avilla = ecosystem.find(entry => entry.id === "avilla");

        expect(kovi).toMatchObject({
            kind: "framework",
            protocols: ["milky.v1", "onebot.v11"],
            priority: "next",
        });
        expect(avilla?.limitation).toContain("WIP");
        expect(ecosystem.every(entry => entry.evidence && entry.limitation)).toBe(true);
        expect(Object.isFrozen(ecosystem)).toBe(true);
        expect(Object.isFrozen(kovi?.protocols)).toBe(true);
    });
});
