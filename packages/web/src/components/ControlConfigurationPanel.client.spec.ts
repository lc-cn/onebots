import { createRenderer } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlClient, ControlConfigurationOperation } from "@onebots/core/control";
import ControlConfigurationPanel from "./ControlConfigurationPanel.vue";
import type { ConfigurationImpact } from "./control-configuration-impact.js";

// 字段编辑器另有回归；此处保留真实保存按钮、校验/应用流程及结果视图。
vi.mock("./ControlConfigurationSections.vue", () => ({ default: { render: () => null } }));

interface ViewNode {
    tag: string;
    text: string;
    props: Record<string, unknown>;
    children: ViewNode[];
    parent?: ViewNode;
}
const node = (tag: string, text = ""): ViewNode => ({ tag, text, props: {}, children: [] });
const renderer = createRenderer<ViewNode, ViewNode>({
    createElement: node,
    createText: text => node("text", text),
    createComment: text => node("comment", text),
    insert(child, parent, anchor) {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        child.parent = parent;
        const index = anchor ? parent.children.indexOf(anchor) : -1;
        parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
    },
    remove(child) {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    },
    patchProp(element, key, _previous, value) {
        element.props[key] = value;
    },
    setText(element, text) {
        element.text = text;
    },
    setElementText(element, text) {
        element.text = text;
        element.children = [];
    },
    parentNode: element => element.parent ?? null,
    nextSibling(element) {
        const siblings = element.parent?.children ?? [];
        return siblings[siblings.indexOf(element) + 1] ?? null;
    },
});

const text = (element: ViewNode): string =>
    element.tag === "comment" ? "" : element.text + element.children.map(text).join("");
const flatten = (element: ViewNode): ViewNode[] => [element, ...element.children.flatMap(flatten)];
const hot: ConfigurationImpact = {
    mode: "hot",
    accounts: [{ platform: "mock", accountId: "a", action: "reconnect" }],
    protocols: [],
    dynamicFields: [],
    restartReasons: [],
};

function fixture(
    impact: ConfigurationImpact | undefined,
    executionMode: "hot" | "restart" | "stored" = "hot",
) {
    const base = { generationId: "generation", configRevision: "a".repeat(64) };
    const draft = {
        id: "00000000-0000-4000-8000-000000000001",
        revision: "b".repeat(64),
        base,
        document: {},
        secretStates: [],
        unknownPaths: [],
    };
    const context = { draft, schemas: {} };
    const store = new Map([
        ["onebots.control.configuration", JSON.stringify({ draftId: draft.id })],
    ]);
    const confirm = vi.fn(() => true);
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
    });
    vi.stubGlobal("window", { confirm });
    let operation: ControlConfigurationOperation;
    const validate = vi.fn(async () => ({
        valid: true,
        issues: [],
        receiptId: "receipt",
        draftRevision: draft.revision,
        ...(impact ? { impact } : {}),
    }));
    const apply = vi.fn(async (id: string) => {
        operation = {
            id,
            validationId: "receipt",
            status: "succeeded",
            phase: "completed",
            recoveryRequired: false,
            executionMode,
            impact,
        };
        return operation;
    });
    const client = {
        configurationDraftContext: vi.fn(async () => context),
        configurationSnapshot: vi.fn(async () => ({ ...draft, schemas: {} })),
        createConfigurationDraft: vi.fn(async () => draft),
        validateConfigurationDraft: validate,
        applyConfiguration: apply,
        configurationOperation: vi.fn(async () => operation),
    } as unknown as ControlClient;
    const root = node("root");
    const app = renderer.createApp(ControlConfigurationPanel, {
        client,
        scope: "accounts",
        gatewayRunning: executionMode !== "stored",
    });
    app.mount(root);
    async function clickSave() {
        await vi.waitFor(() =>
            expect(
                flatten(root).some(
                    item => item.tag === "button" && text(item) === "保存" && !item.props.disabled,
                ),
            ).toBe(true),
        );
        const button = flatten(root).find(item => item.tag === "button" && text(item) === "保存")!;
        const handler = button.props.onClick;
        if (typeof handler !== "function") throw new Error("保存按钮没有事件处理器");
        await handler();
    }
    return { root, apply, validate, confirm, clickSave, close: () => app.unmount() };
}

afterEach(() => vi.unstubAllGlobals());

describe("配置保存的实例影响与重启确认", () => {
    it("热更新先检测再发送应用，不弹全局断连确认，并保留结果", async () => {
        const f = fixture(hot);
        try {
            await f.clickSave();
            expect(f.confirm).not.toHaveBeenCalled();
            expect(f.apply).toHaveBeenCalledWith(expect.any(String), "receipt", undefined);
            expect(f.validate.mock.invocationCallOrder[0]).toBeLessThan(
                f.apply.mock.invocationCallOrder[0],
            );
            expect(text(f.root)).toContain("设置已按实例更新，无需重启网关。");
            expect(text(f.root)).toContain("重连账号 1 项");
        } finally {
            f.close();
        }
    });
    it("取消全局重启时不产生应用请求，影响详情默认收起", async () => {
        const f = fixture({ ...hot, mode: "restart", restartReasons: ["port"] }, "restart");
        f.confirm.mockReturnValue(false);
        try {
            await f.clickSave();
            expect(f.confirm).toHaveBeenCalledOnce();
            expect(f.apply).not.toHaveBeenCalled();
            expect(text(f.root)).toContain("所有账号和协议连接将短暂中断");
            expect(
                flatten(f.root).find(item => item.tag === "details")?.props.open,
            ).toBeUndefined();
        } finally {
            f.close();
        }
    });
    it("确认重启时显式授权同一校验回执，不把授权带到普通热更新", async () => {
        const f = fixture({ ...hot, mode: "restart", restartReasons: ["port"] }, "restart");
        try {
            await f.clickSave();
            expect(f.apply).toHaveBeenCalledWith(expect.any(String), "receipt", {
                allowRestart: true,
            });
        } finally {
            f.close();
        }
    });
    it("运行中缺少影响计划时保留草稿并要求重新检测，不能猜测热更新", async () => {
        const f = fixture(undefined);
        try {
            await f.clickSave();
            expect(f.apply).not.toHaveBeenCalled();
            expect(f.confirm).not.toHaveBeenCalled();
            expect(text(f.root)).toContain("请重新检测配置");
        } finally {
            f.close();
        }
    });
    it("网关未运行时保存不要求重启授权，结果明确下次启动生效", async () => {
        const f = fixture({ ...hot, mode: "restart", restartReasons: ["port"] }, "stored");
        try {
            await f.clickSave();
            expect(f.confirm).not.toHaveBeenCalled();
            expect(f.apply).toHaveBeenCalledWith(expect.any(String), "receipt", undefined);
            expect(text(f.root)).toContain("将在下次启动网关时生效");
            expect(text(f.root)).not.toContain("所有账号和协议连接将短暂中断");
        } finally {
            f.close();
        }
    });
    it("未改配置时不承诺重连，显示连接保持原状", async () => {
        const f = fixture({
            mode: "none",
            accounts: [],
            protocols: [],
            dynamicFields: [],
            restartReasons: [],
        });
        try {
            await f.clickSave();
            expect(f.confirm).not.toHaveBeenCalled();
            expect(text(f.root)).toContain("配置没有变化，连接保持原状。");
            expect(text(f.root)).not.toContain("重连账号");
        } finally {
            f.close();
        }
    });
});
