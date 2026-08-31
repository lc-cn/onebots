import type { Client } from "@icqqjs/icqq";
import { describe, expect, it, vi } from "vitest";
import { ICQQGuildFileActions } from "./guild-file-actions.js";

const id = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value) || 0,
});

function createActions(client: Client): ICQQGuildFileActions {
    const actions = Object.create(ICQQGuildFileActions.prototype) as ICQQGuildFileActions;
    Object.defineProperties(actions, {
        requireNativeClient: { value: () => client },
        numericId: { value: (value: string) => Number(value) },
        createId: { value: id },
    });
    return actions;
}

describe("ICQQ 群文件动作", () => {
    it("保真返回 Milky 所需的群文件与文件夹元数据", async () => {
        const dir = vi.fn().mockResolvedValue([
            {
                fid: "file",
                pid: "/",
                name: "demo.txt",
                user_id: 10001,
                create_time: 100,
                modify_time: 101,
                is_dir: false,
                size: 5,
                busid: 1,
                md5: "md5",
                sha1: "sha1",
                duration: 60,
                download_times: 2,
            },
            {
                fid: "/folder",
                pid: "/",
                name: "folder",
                user_id: 10002,
                create_time: 200,
                modify_time: 201,
                is_dir: true,
                file_count: 3,
            },
        ]);
        const client = { acquireGfs: vi.fn(() => ({ dir })) } as unknown as Client;

        const result = await createActions(client).getGroupFiles("bot", {
            group_id: id(20000),
            parent_folder_id: id("/"),
        });

        expect(result.files[0]).toMatchObject({
            parent_folder_id: { string: "/" },
            uploaded_time: 100,
            expire_time: 160,
            uploader_id: { number: 10001 },
            downloaded_times: 2,
        });
        expect(result.folders[0]).toMatchObject({
            created_time: 200,
            last_modified_time: 201,
            creator_id: { number: 10002 },
            file_count: 3,
        });
    });

    it("移动文件时使用显式目标文件夹", async () => {
        const mv = vi.fn().mockResolvedValue(undefined);
        const client = { acquireGfs: vi.fn(() => ({ mv })) } as unknown as Client;

        await createActions(client).moveGroupFile("bot", {
            group_id: id(20000),
            file_id: id("file"),
            target_folder_id: id("/target"),
        });

        expect(mv).toHaveBeenCalledWith("file", "/target");
    });
});
