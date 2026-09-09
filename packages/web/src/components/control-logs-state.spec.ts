import { describe, expect, it, vi } from "vitest";
import { LogController, logView } from "./control-logs-state";
const snapshot = { source: "gateway" as const, text: "secret", exists: true, truncated: false };
describe("manual gateway log view", () => {
    it("reads only manually, strips escapes and clears previous content on failure", async () => {
        const gateway = vi.fn().mockResolvedValue({ ...snapshot, text: "\x1b[2Jsecret" });
        const view = logView();
        const controller = new LogController({ logs: { gateway } }, view);
        expect(gateway).not.toHaveBeenCalled();
        await controller.refresh();
        expect(view.snapshot?.text).toBe("secret");
        gateway.mockRejectedValue(new Error("credential leak"));
        const pending = controller.refresh();
        expect(view.snapshot).toBeUndefined();
        await pending;
        expect(view.error).not.toContain("credential");
        expect(view.snapshot).toBeUndefined();
    });
    it("suppresses duplicate reads and discards late results after client changes", async () => {
        let finish!: (value: typeof snapshot) => void;
        const gateway = vi.fn().mockReturnValue(
            new Promise(resolve => {
                finish = resolve;
            }),
        );
        const view = logView();
        const controller = new LogController({ logs: { gateway } }, view);
        const pending = controller.refresh();
        await controller.refresh();
        expect(gateway).toHaveBeenCalledTimes(1);
        const next = vi.fn().mockResolvedValue({ ...snapshot, text: "new device" });
        controller.setClient({ logs: { gateway: next } });
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
        const gateway = vi.fn().mockReturnValue(
            new Promise(resolve => {
                finish = resolve;
            }),
        );
        const view = logView();
        const controller = new LogController({ logs: { gateway } }, view);
        const pending = controller.refresh();
        controller.dispose();
        finish(snapshot);
        await pending;
        expect(view).toEqual(logView());
    });
});
