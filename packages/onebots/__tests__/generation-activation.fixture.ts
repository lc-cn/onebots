import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect } from "vitest";
import { GatewayController } from "../src/control/gateway-controller.js";
import { GenerationActivationController } from "../src/control/generation-activation.js";
import type { VerifiedGeneration } from "../src/installation/generation-store.js";

const directories: string[] = [];
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
    );
});

export function verified(id: string): VerifiedGeneration {
    return {
        id,
        directory: `/generations/${id}`,
        operationId: "install-1",
        planDigest: "a".repeat(64),
        receipt: {
            schemaVersion: 1,
            phase: "verified",
            id,
            storeId: "store-1",
            operationId: "install-1",
            verifiedAt: "2026-09-08T00:00:00.000Z",
            planDigest: "a".repeat(64),
            hostVersion: "1.2.12",
            coreVersion: "1.0.4",
            platform: process.platform,
            arch: process.arch,
            nodeAbi: process.versions.modules,
            lockDigest: "b".repeat(64),
            schemasDigest: "c".repeat(64),
            hostManifestDigest: "d".repeat(64),
            coreManifestDigest: "e".repeat(64),
            checks: {
                packageIdentity: true,
                peerDependencies: true,
                singleHost: true,
                loadRegistration: true,
                schemas: true,
            },
        },
    };
}

export async function fixture(
    verifyActivation?: (generation: VerifiedGeneration) => Promise<() => void>,
) {
    const directory = await mkdtemp(join(tmpdir(), "onebots-activation-"));
    directories.push(directory);
    const events: string[] = [];
    const state = {
        live: false,
        configurationRecovery: false,
        failTarget: false,
        leakTarget: false,
        failRollback: false,
        stopBarrier: undefined as Promise<void> | undefined,
        afterStart: undefined as (() => Promise<void>) | undefined,
    };
    const statePath = join(directory, "activation.json");
    let activation: GenerationActivationController;
    let sequence = 0;
    const gateway = new GatewayController({
        statePath: join(directory, "gateway.json"),
        driver: {
            async start() {
                const generation = activation.activeGeneration()?.id ?? "bundled";
                events.push(`start:${generation}`);
                const persisted = JSON.parse(await readFile(statePath, "utf8"));
                expect(persisted.active?.id ?? "bundled").toBe(generation);
                if (generation === "target" && state.failTarget) {
                    state.live = state.leakTarget;
                    throw new Error("target failed");
                }
                if (generation === "bundled" && state.failRollback && events.length > 1)
                    throw new Error("rollback failed");
                expect(state.live).toBe(false);
                state.live = true;
                await state.afterStart?.();
                return { id: String(++sequence) };
            },
            async stop() {
                events.push("stop");
                if (state.stopBarrier) await state.stopBarrier;
                state.live = false;
            },
        },
    });
    const options = {
        statePath,
        gateway,
        verifyActivation,
        readVerified: (id: string) => {
            if (!["target", "other"].includes(id)) throw new Error("not verified");
            return verified(id);
        },
        hasLiveChildren: () => state.live,
        configurationRecoveryRequired: () => state.configurationRecovery,
    };
    activation = new GenerationActivationController(options);
    await activation.initialize();
    return { activation, gateway, state, statePath, options, events };
}
