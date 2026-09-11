import { describe, expect, it, vi } from "vitest";
import {
    createConfirmedConfigurationRepair,
    loadConfigurationPanelSource,
    type ConfigurationSourceClient,
} from "./control-configuration-source.js";
const base = { generationId: null, configRevision: "a".repeat(64) };
const context = {
    draft: {
        id: "draft",
        revision: "b".repeat(64),
        base,
        document: {},
        secretStates: [],
        unknownPaths: [],
    },
    schemas: { adapters: {} },
};
function fixture() {
    const client: ConfigurationSourceClient = {
        configurationSnapshot: vi.fn(async () => ({ ...context.draft, schemas: context.schemas })),
        configurationSource: vi.fn(async () => ({
            state: "damaged" as const,
            base,
            reason: "INVALID_YAML" as const,
            repairAvailable: true,
        })),
        configurationDraftContext: vi.fn(async () => context),
        createConfigurationRepairDraft: vi.fn(async () => context),
    };
    return client;
}
describe("配置来源与显式修复", () => {
    it("正常snapshot不查询损坏状态或自动创建修复", async () => {
        const client = fixture();
        expect((await loadConfigurationPanelSource(client)).snapshot).toBeDefined();
        expect(client.configurationSource).not.toHaveBeenCalled();
        expect(client.createConfigurationRepairDraft).not.toHaveBeenCalled();
    });
    it("只有snapshot失败且source明确damaged才显示修复状态，绝不伪造空snapshot", async () => {
        const client = fixture();
        vi.mocked(client.configurationSnapshot).mockRejectedValue(new Error("secret YAML"));
        const result = await loadConfigurationPanelSource(client);
        expect(result).toEqual({
            source: { state: "damaged", base, reason: "INVALID_YAML", repairAvailable: true },
            draftUnavailable: false,
        });
        expect(result.snapshot).toBeUndefined();
        expect(client.createConfigurationRepairDraft).not.toHaveBeenCalled();
        vi.mocked(client.configurationSource).mockRejectedValue(new Error("permission denied"));
        await expect(loadConfigurationPanelSource(client)).rejects.toThrow();
        vi.mocked(client.configurationSource).mockResolvedValue({ state: "ready", base });
        await expect(loadConfigurationPanelSource(client)).rejects.toThrow("配置暂不可读取");
    });
    it("重载已有草稿通过context恢复schemas，不要求原配置可解析也不重新提交", async () => {
        const client = fixture();
        vi.mocked(client.configurationSnapshot).mockRejectedValue(new Error("broken"));
        expect(await loadConfigurationPanelSource(client, "repair-draft")).toEqual({ context });
        expect(client.configurationDraftContext).toHaveBeenCalledWith("repair-draft");
        expect(client.configurationSnapshot).not.toHaveBeenCalled();
        expect(client.createConfigurationRepairDraft).not.toHaveBeenCalled();
    });
    it("需明确确认且修复可用才调用接口，只发送base", async () => {
        const client = fixture();
        const source = await client.configurationSource();
        await expect(createConfirmedConfigurationRepair(client, source, false)).rejects.toThrow();
        await expect(
            createConfirmedConfigurationRepair(client, { ...source, repairAvailable: false }, true),
        ).rejects.toThrow();
        expect(client.createConfigurationRepairDraft).not.toHaveBeenCalled();
        expect(await createConfirmedConfigurationRepair(client, source, true)).toEqual(context);
        expect(client.createConfigurationRepairDraft).toHaveBeenCalledExactlyOnceWith(base);
    });
});
