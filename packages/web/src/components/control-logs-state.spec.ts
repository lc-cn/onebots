import { describe, expect, it, vi } from "vitest";
import { LogController, logView } from "./control-logs-state";
const snapshot = {
    schemaVersion: 1 as const,
    source: "gateway" as const,
    text: "secret",
    exists: true,
    truncated: false,
    cursor: "0123456789abcdef.6",
    reset: false,
};
describe("manual unified log view", () => {
    it("reads only manually, strips escapes and clears previous content on failure", async () => {
        const query = vi.fn().mockResolvedValue({ ...snapshot, text: "\x1b[2Jsecret" });
        const view = logView();
        const controller = new LogController({ logs: { query } }, view);
        expect(query).not.toHaveBeenCalled();
        await controller.refresh();
        expect(query).toHaveBeenCalledWith({ source: "gateway" });
        expect(view.snapshot?.text).toBe("secret");
        query.mockRejectedValue(new Error("credential leak"));
        const pending = controller.refresh();
        expect(view.snapshot).toBeUndefined();
        await pending;
        expect(view.error).not.toContain("credential");
        expect(view.snapshot).toBeUndefined();
    });
    it("suppresses duplicate reads and discards late results after client changes", async () => {
        let finish!: (value: typeof snapshot) => void;
        const query = vi.fn().mockReturnValue(
            new Promise(resolve => {
                finish = resolve;
            }),
        );
        const view = logView();
        const controller = new LogController({ logs: { query } }, view);
        const pending = controller.refresh();
        await controller.refresh();
        expect(query).toHaveBeenCalledTimes(1);
        const next = vi.fn().mockResolvedValue({ ...snapshot, text: "new device" });
        controller.setClient({ logs: { query: next } });
        expect(next).not.toHaveBeenCalled();
        finish(snapshot);
        await pending;
        expect(view.snapshot).toBeUndefined();
        await controller.refresh();
        expect(view.snapshot?.text).toBe("new device");
        controller.dispose();
        expect(view.snapshot).toBeUndefined();
        await controller.refresh();
        expect(next).toHaveBeenCalledTimes(1);
    });
    it("discards in-flight content when authorization view is unmounted", async () => {
        let finish!: (value: typeof snapshot) => void;
        const query = vi.fn().mockReturnValue(
            new Promise(resolve => {
                finish = resolve;
            }),
        );
        const view = logView();
        const controller = new LogController({ logs: { query } }, view);
        const pending = controller.refresh();
        controller.dispose();
        finish(snapshot);
        await pending;
        expect(view).toEqual(logView());
    });
    it("clears prior content when the operator changes sources", async () => {
        const query = vi.fn().mockResolvedValue(snapshot);
        const view = logView();
        const controller = new LogController({ logs: { query } }, view);
        await controller.refresh();
        controller.setSource("operation");
        expect(view.snapshot).toBeUndefined();
        await controller.refresh();
        expect(query).toHaveBeenLastCalledWith({ source: "operation" });
    });
});
