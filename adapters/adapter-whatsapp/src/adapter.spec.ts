import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStatus, SqliteDB, type CommonTypes } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { WhatsAppAdapter } from "./adapter.js";

describe("WhatsApp 标准群能力", () => {
    it("Client 生命周期停止时立即同步账号离线状态", async () => {
        await withAdapter(async (_adapter, client, account) => {
            vi.spyOn(client, "getPhoneNumberInfo").mockResolvedValue({ id: "phone" });
            await client.start();
            account.status = AccountStatus.Online;

            await client.stop();

            expect(account.status).toBe(AccountStatus.OffLine);
        });
    });

    it("用 recipient_type=group 发送标准群消息", async () => {
        await withAdapter(async (adapter, client) => {
            const sendMessage = vi.spyOn(client, "sendMessage").mockResolvedValue({
                messaging_product: "whatsapp",
                messages: [{ id: "wamid.group" }],
            });

            await expect(
                adapter.sendMessage("bot", {
                    scene_type: "group",
                    scene_id: id("group@g.us"),
                    message: [{ type: "text", data: { text: "hello" } }],
                }),
            ).resolves.toMatchObject({ message_id: { string: "wamid.group" } });
            expect(sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: "group@g.us",
                    recipient_type: "group",
                    type: "text",
                }),
            );
        });
    });

    it("把 Groups API 资料和 BSUID 成员映射到标准实体", async () => {
        await withAdapter(async (adapter, client) => {
            vi.spyOn(client.groups, "listAll").mockResolvedValue([
                {
                    id: "g1@g.us",
                    subject: "Support",
                    suspended: false,
                    creation_timestamp: 100,
                    total_participant_count: 0,
                    participants: [],
                    join_approval_mode: "approval_required",
                },
            ]);
            vi.spyOn(client.groups, "get").mockResolvedValue({
                id: "g1@g.us",
                subject: "Support",
                description: "Customers",
                creation_timestamp: 100,
                total_participant_count: 2,
                suspended: false,
                join_approval_mode: "approval_required",
                participants: [
                    { user_id: "BR.1", username: "alice" },
                    { user_id: "BR.2", wa_id: "86124" },
                ],
            });

            await expect(adapter.getGroupList("bot")).resolves.toEqual([
                expect.objectContaining({
                    group_id: expect.objectContaining({ string: "g1@g.us" }),
                    group_name: "Support",
                }),
            ]);
            await expect(
                adapter.getGroupMemberInfo("bot", {
                    group_id: id("g1@g.us"),
                    user_id: id("BR.1"),
                }),
            ).resolves.toMatchObject({
                user_id: { string: "BR.1" },
                user_name: "alice",
                role: "member",
            });
        });
    });

    it("复用 Groups 模块处理改名、移除与入群申请", async () => {
        await withAdapter(async (adapter, client) => {
            const update = vi
                .spyOn(client.groups, "update")
                .mockResolvedValue({ request_id: "update" });
            const remove = vi
                .spyOn(client.groups, "removeParticipants")
                .mockResolvedValue({ request_id: "remove" });
            const approve = vi
                .spyOn(client.groups, "approveJoinRequests")
                .mockResolvedValue({ approved_join_requests: ["join-1"] });

            await adapter.setGroupName("bot", {
                group_id: id("g1@g.us"),
                group_name: "Renamed",
            });
            await adapter.kickGroupMember("bot", {
                group_id: id("g1@g.us"),
                user_id: id("BR.2"),
            });
            await adapter.handleGroupRequest("bot", {
                group_id: id("g1@g.us"),
                request_id: id("join-1"),
                type: "request",
                approve: true,
            });

            expect(update).toHaveBeenCalledWith("g1@g.us", { subject: "Renamed" });
            expect(remove).toHaveBeenCalledWith("g1@g.us", ["BR.2"]);
            expect(approve).toHaveBeenCalledWith("g1@g.us", ["join-1"]);
        });
    });

    it("拒绝伪装成直接拉人的标准邀请语义", async () => {
        await withAdapter(async adapter => {
            expect(() =>
                adapter.inviteGroupMember("bot", {
                    group_id: id("g1@g.us"),
                    user_id: id("86123"),
                }),
            ).toThrowError(
                expect.objectContaining({
                    code: "ADAPTER_CAPABILITY_UNAVAILABLE",
                    capability: "invite_group_member",
                }),
            );
        });
    });

    it("移除成员统一使用 Meta 的 user 身份参数", async () => {
        await withAdapter(async (adapter, client) => {
            const remove = vi
                .spyOn(client.groups, "removeParticipants")
                .mockResolvedValue({ request_id: "remove" });

            await adapter.kickGroupMember("bot", {
                group_id: id("g1@g.us"),
                user_id: id("86123"),
            });

            expect(remove).toHaveBeenCalledWith("g1@g.us", ["86123"]);
        });
    });
});

async function withAdapter(
    run: (
        adapter: WhatsAppAdapter,
        client: ReturnType<WhatsAppAdapter["createAccount"]>["client"],
        account: ReturnType<WhatsAppAdapter["createAccount"]>,
    ) => Promise<void>,
): Promise<void> {
    const filename = join(tmpdir(), `onebots-whatsapp-adapter-${randomUUID()}.db`);
    const db = new SqliteDB(filename);
    try {
        const adapter = new WhatsAppAdapter({
            db,
            getLogger: () => ({
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            }),
        } as never);
        const account = adapter.createAccount({
            account_id: "bot",
            business_account_id: "waba",
            phone_number_id: "phone",
            access_token: "token",
            api_version: "v23.0",
            receive_mode: "manual",
        });
        adapter.accounts.set("bot", account);
        await run(adapter, account.client, account);
    } finally {
        db.close();
        rmSync(filename, { force: true });
    }
}

function id(value: string): CommonTypes.Id {
    return { string: value, source: value, number: Number(value) };
}
