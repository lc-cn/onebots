import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { ControlVerificationOperation } from "@onebots/core/control";
import { fixture } from "../../__tests__/generation-activation.fixture.js";
import { acknowledgeVerificationWhileStopped } from "./host-verification.js";

function receipt(): ControlVerificationOperation {
    return {
        id: randomUUID(),
        challengeId: randomUUID(),
        gatewayInstanceId: randomUUID(),
        configVersion: "config-1",
        action: "submit",
        status: "unknown",
        startedAt: "2026-09-09T00:00:00.000Z",
        finishedAt: "2026-09-09T00:00:01.000Z",
    };
}

it("accepts only a stopped gateway and never starts, stops or dispatches validation", async () => {
    const { activation, events } = await fixture();
    const record = receipt();
    const commit = vi.fn(() => record);
    expect(
        await acknowledgeVerificationWhileStopped(
            { lifecycle: activation, available: () => true },
            commit,
        ),
    ).toBe(record);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    await activation.start();
    await expect(
        acknowledgeVerificationWhileStopped(
            { lifecycle: activation, available: () => true },
            commit,
        ),
    ).rejects.toMatchObject({ httpStatus: 409 });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["start:bundled"]);
});

it("rechecks host closure, ownership or maintenance availability after waiting in the lifecycle queue", async () => {
    const { activation } = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>(resolve => {
        release = resolve;
    });
    const ready = new Promise<void>(resolve => {
        entered = resolve;
    });
    const previous = activation.runConfigurationTransaction(async () => {
        entered();
        await barrier;
    });
    await ready;
    let available = true;
    const commit = vi.fn(receipt);
    const result = acknowledgeVerificationWhileStopped(
        { lifecycle: activation, available: () => available },
        commit,
    );
    const rejected = expect(result).rejects.toMatchObject({ httpStatus: 409 });
    available = false;
    release();
    await previous;
    await rejected;
    expect(commit).not.toHaveBeenCalled();
});

it("rechecks a start queued ahead of acknowledgment instead of trusting stopped state at arrival", async () => {
    const { activation, events } = await fixture();
    const starting = activation.start();
    const commit = vi.fn(receipt);
    const result = acknowledgeVerificationWhileStopped(
        { lifecycle: activation, available: () => true },
        commit,
    );
    const rejected = expect(result).rejects.toMatchObject({ httpStatus: 409 });
    await starting;
    await rejected;
    expect(commit).not.toHaveBeenCalled();
    expect(events).toEqual(["start:bundled"]);
});

it("waits for an explicitly requested stop to reap the process before committing", async () => {
    const { activation, state, events } = await fixture();
    await activation.start();
    let release!: () => void;
    state.stopBarrier = new Promise<void>(resolve => {
        release = resolve;
    });
    const stopping = activation.stop();
    const commit = vi.fn(() => {
        expect(state.live).toBe(false);
        expect(activation.status().gateway.actual).toBe("stopped");
        return receipt();
    });
    const result = acknowledgeVerificationWhileStopped(
        { lifecycle: activation, available: () => true },
        commit,
    );
    await new Promise(resolve => setImmediate(resolve));
    expect(commit).not.toHaveBeenCalled();
    release();
    await stopping;
    await result;
    expect(commit).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["start:bundled", "stop"]);
});

it("rejects a live child even if the controller says stopped and rejects pending configuration recovery", async () => {
    const { activation, state } = await fixture();
    const commit = vi.fn(receipt);
    state.live = true;
    await expect(
        acknowledgeVerificationWhileStopped(
            { lifecycle: activation, available: () => true },
            commit,
        ),
    ).rejects.toMatchObject({ httpStatus: 409 });
    state.live = false;
    state.configurationRecovery = true;
    await expect(
        acknowledgeVerificationWhileStopped(
            { lifecycle: activation, available: () => true },
            commit,
        ),
    ).rejects.toThrow("配置事务需要对账");
    expect(commit).not.toHaveBeenCalled();
});
