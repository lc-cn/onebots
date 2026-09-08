import { mkdirSync, renameSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { fixture, verified } from "../../__tests__/generation-activation.fixture.js";

describe("candidate configuration verification", () => {
    it.each([false, true])(
        "verifies before effects and preserves state on rejection (running=%s)",
        async running => {
            const check = vi.fn(async () => {
                throw new Error("invalid candidate configuration");
            });
            const f = await fixture(check);
            if (running) await f.activation.start();
            const before = f.activation.status();
            const events = [...f.events];
            const revision = "a".repeat(64);
            await expect(f.activation.activate("target", null, revision)).rejects.toThrow(
                "invalid candidate configuration",
            );
            expect(check).toHaveBeenCalledExactlyOnceWith(verified("target"), revision);
            expect(f.activation.status()).toEqual(before);
            expect(f.events).toEqual(events);
        },
    );
    it("validates stopped candidates and repeated successful target is idempotent", async () => {
        const guard = vi.fn();
        const verify = vi.fn(async () => guard);
        const f = await fixture(verify);
        const first = await f.activation.activate("target", null);
        expect(first.status).toBe("succeeded");
        expect(verify).toHaveBeenCalledTimes(1);
        expect(guard).toHaveBeenCalledTimes(3);
        expect(f.events).toEqual([]);
        expect(await f.activation.activate("target", null)).toEqual(first);
        expect(verify).toHaveBeenCalledTimes(1);
        expect(guard).toHaveBeenCalledTimes(3);
    });
    it("keeps configuration transactions outside the awaited verification and switch", async () => {
        let enter!: () => void;
        let release!: () => void;
        const entered = new Promise<void>(resolve => {
            enter = resolve;
        });
        const barrier = new Promise<void>(resolve => {
            release = resolve;
        });
        const sequence: string[] = [];
        const f = await fixture(async () => {
            sequence.push("verify");
            enter();
            await barrier;
            return () => {
                sequence.push("guard");
            };
        });
        const activation = f.activation.activate("target");
        await entered;
        const configuration = f.activation.runConfigurationTransaction(async port => {
            sequence.push("configuration");
            expect(port.activeGenerationId()).toBe("target");
        });
        await new Promise(resolve => setImmediate(resolve));
        expect(sequence).toEqual(["verify"]);
        release();
        await activation;
        await configuration;
        expect(sequence).toEqual(["verify", "guard", "guard", "guard", "configuration"]);
    });
    it.each([1, 2])("fails safely if snapshot changes at pre-suspend guard %d", async failAt => {
        let checks = 0;
        const f = await fixture(async () => () => {
            if (++checks === failAt) throw new Error("changed");
        });
        await f.activation.start();
        const result = await f.activation.activate("target");
        expect(result).toMatchObject({ status: "failed", phase: "failed" });
        expect(f.activation.status()).toMatchObject({ active: null, recoveryRequired: false });
        expect(f.events).toEqual(["start:bundled"]);
        const saved = JSON.parse(await readFile(f.statePath, "utf8"));
        expect(saved.operations.at(-1)).toMatchObject({ status: "failed", phase: "failed" });
        expect(saved.recoveryRequired).toBe(false);
    });
    it("does not activate or restart after configuration changes during suspension", async () => {
        let changed = false;
        const f = await fixture(async () => () => {
            if (changed) throw new Error("changed");
        });
        await f.activation.start();
        let release!: () => void;
        f.state.stopBarrier = new Promise<void>(resolve => {
            release = resolve;
        });
        const result = f.activation.activate("target");
        await vi.waitFor(() => expect(f.events).toContain("stop"));
        changed = true;
        release();
        expect(await result).toMatchObject({ status: "failed" });
        expect(f.activation.status()).toMatchObject({ active: null, recoveryRequired: true });
        expect(f.events).toEqual(["start:bundled", "stop"]);
    });
});

it("cannot declare a safe rejection durable when its terminal write fails", async () => {
    let statePath = "";
    const f = await fixture(async () => () => {
        renameSync(statePath, `${statePath}.saved`);
        mkdirSync(statePath);
        throw new Error("snapshot changed");
    });
    statePath = f.statePath;
    await f.activation.start();
    await expect(f.activation.activate("target")).rejects.toThrow();
    expect(f.events).toEqual(["start:bundled"]);
    expect(f.activation.status()).toMatchObject({ active: null, recoveryRequired: true });
    await expect(f.activation.activate("other")).rejects.toThrow("需要对账");
});
