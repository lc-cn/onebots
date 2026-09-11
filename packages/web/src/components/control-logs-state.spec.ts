import { describe, expect, it, vi } from "vitest";
import type {
    ControlLogBatch,
    ControlLogQuery,
    ControlLogStreamOptions,
} from "@onebots/core/control";
import { LogController, logView } from "./control-logs-state";

const batch = (source: ControlLogQuery["source"], text = "line\n"): ControlLogBatch => ({
    schemaVersion: 1,
    source,
    text,
    exists: true,
    truncated: false,
    cursor: "0123456789abcdef.6",
    reset: false,
});

function liveStream(
    calls: Array<{ query: ControlLogQuery; signal: AbortSignal }>,
    text = "line\n",
) {
    return vi.fn(async function* (query: ControlLogQuery, options: ControlLogStreamOptions = {}) {
        const signal = options.signal ?? new AbortController().signal;
        calls.push({ query, signal });
        yield batch(query.source, text);
        await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve()));
    });
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("live unified log view", () => {
    it("connects only while active and physically aborts when the page is hidden", async () => {
        const calls: Array<{ query: ControlLogQuery; signal: AbortSignal }> = [];
        const stream = liveStream(calls);
        const view = logView();
        const controller = new LogController({ logs: { stream } }, view);
        expect(stream).not.toHaveBeenCalled();
        controller.setActive(true);
        await settle();
        expect(calls[0].query).toEqual({ source: "gateway" });
        expect(view.sources.gateway.status).toBe("live");
        controller.setActive(false);
        expect(calls[0].signal.aborted).toBe(true);
        expect(view.sources.gateway.status).toBe("paused");
        controller.dispose();
    });

    it("aborts the previous tab before connecting the selected source", async () => {
        const calls: Array<{ query: ControlLogQuery; signal: AbortSignal }> = [];
        const view = logView();
        const controller = new LogController({ logs: { stream: liveStream(calls) } }, view);
        controller.setActive(true);
        await settle();
        controller.setSource("manager");
        await settle();
        expect(calls[0].signal.aborted).toBe(true);
        expect(calls[1].query).toEqual({ source: "manager" });
        expect(view.sources.gateway.snapshot?.text).toBe("line\n");
        expect(view.sources.manager.snapshot?.text).toBe("line\n");
        controller.dispose();
    });

    it("resumes a visited tab from its opaque cursor and sanitizes appended text", async () => {
        const calls: Array<{ query: ControlLogQuery; signal: AbortSignal }> = [];
        const view = logView();
        const controller = new LogController(
            { logs: { stream: liveStream(calls, "\u001b[2Jsecret\n") } },
            view,
        );
        controller.setActive(true);
        await settle();
        controller.setSource("manager");
        await settle();
        controller.setSource("gateway");
        await settle();
        expect(calls[2].query).toEqual({
            source: "gateway",
            cursor: "0123456789abcdef.6",
        });
        expect(view.sources.gateway.snapshot?.text).toBe("secret\nsecret\n");
        controller.dispose();
    });

    it("keeps failures on the current tab and reconnects only on retry", async () => {
        const stream = vi.fn(async function* () {
            throw new Error("credential leak");
        });
        const view = logView();
        const controller = new LogController({ logs: { stream } }, view);
        controller.setActive(true);
        await settle();
        expect(view.sources.gateway.status).toBe("error");
        expect(view.sources.gateway.error).not.toContain("credential");
        controller.retry();
        await settle();
        expect(stream).toHaveBeenCalledTimes(2);
        controller.dispose();
    });

    it("clears all sensitive snapshots when the client changes or the view is disposed", async () => {
        const firstCalls: Array<{ query: ControlLogQuery; signal: AbortSignal }> = [];
        const nextCalls: Array<{ query: ControlLogQuery; signal: AbortSignal }> = [];
        const view = logView();
        const controller = new LogController({ logs: { stream: liveStream(firstCalls) } }, view);
        controller.setActive(true);
        await settle();
        controller.setClient({ logs: { stream: liveStream(nextCalls, "next\n") } });
        await settle();
        expect(firstCalls[0].signal.aborted).toBe(true);
        expect(view.sources.gateway.snapshot?.text).toBe("next\n");
        controller.dispose();
        expect(nextCalls[0].signal.aborted).toBe(true);
        expect(view.sources.gateway.snapshot).toBeUndefined();
    });
});
