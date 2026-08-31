import type { Adapter } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { executeMilkyFileAction } from "./file-actions.js";

const id = (value: string | number) => ({
    string: String(value),
    number: typeof value === "number" ? value : 42,
    source: value,
});

function createAdapter() {
    const moveGroupFile = vi.fn();
    const adapter = {
        resolveId: vi.fn(id),
        moveGroupFile,
        getGroupFiles: vi.fn().mockResolvedValue({
            files: [
                {
                    group_id: id(20001),
                    file_id: id("file-id"),
                    file_name: "demo.txt",
                    parent_folder_id: id("/"),
                    file_size: 5,
                    uploaded_time: 100,
                    uploader_id: id(10001),
                    downloaded_times: 2,
                },
            ],
            folders: [],
        }),
    } as unknown as Adapter;
    return { adapter, moveGroupFile };
}

describe("Milky 文件动作", () => {
    it("集中投影文件实体与根目录语义", async () => {
        const { adapter } = createAdapter();
        await expect(
            executeMilkyFileAction(adapter, "bot", "get_group_files", { group_id: 20001 }),
        ).resolves.toEqual({
            files: [
                expect.objectContaining({
                    group_id: 20001,
                    file_id: "file-id",
                    parent_folder_id: "/",
                    uploader_id: 10001,
                }),
            ],
            folders: [],
        });
    });

    it("可变动作统一返回空对象", async () => {
        const { adapter, moveGroupFile } = createAdapter();
        await expect(
            executeMilkyFileAction(adapter, "bot", "move_group_file", {
                group_id: 20001,
                file_id: "file-id",
            }),
        ).resolves.toEqual({});
        expect(moveGroupFile).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({ target_folder_id: expect.objectContaining({ string: "/" }) }),
        );
    });
});
