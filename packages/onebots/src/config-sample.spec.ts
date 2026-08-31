import fs from "node:fs";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";

describe("default configuration sample", () => {
    it("boots without placeholder platform accounts", () => {
        const config = yaml.load(
            fs.readFileSync(new URL("./config.sample.yaml", import.meta.url), "utf8"),
        ) as Record<string, unknown>;
        const accountKeys = Object.keys(config).filter(key => key.includes("."));

        expect(accountKeys).toEqual([]);
        expect(config.port).toBe(6727);
        expect(config.general).toEqual({});
    });
});
