import { describe, expect, it, vi } from "vitest";
import { SlackAdapter } from "./adapter.js";

const id = (value: string) => ({ string: value, number: 1, source: value });

describe("Slack canonical 文件动作", () => {
    it("将 files.info 闭合为统一文件模型", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: true,
            file: {
                id: "F1",
                name: "report.pdf",
                size: 42,
                url_private_download: "https://files.slack.com/report.pdf",
                created: 123,
                user: "U1",
            },
        });
        const adapter = Object.create(SlackAdapter.prototype) as SlackAdapter;
        Object.defineProperties(adapter, {
            getAccount: { value: () => ({ client: { call } }) },
            createId: { value: id },
        });

        await expect(adapter.getFile("bot", { file_id: id("F1") })).resolves.toEqual({
            file_id: id("F1"),
            file_name: "report.pdf",
            file_size: 42,
            url: "https://files.slack.com/report.pdf",
            uploaded_time: 123,
            uploader_id: id("U1"),
        });
        expect(call).toHaveBeenCalledWith("files.info", { file: "F1" });
    });

    it("通过 canonical delete_file 调用 files.delete", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        const adapter = Object.create(SlackAdapter.prototype) as SlackAdapter;
        Object.defineProperty(adapter, "getAccount", { value: () => ({ client: { call } }) });

        await adapter.deleteFile("bot", { file_id: id("F1") });
        expect(call).toHaveBeenCalledWith("files.delete", { file: "F1" });
    });
});
