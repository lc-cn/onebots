import { createRenderer, nextTick, type Component } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlClient, ControlInstallPlan } from "@onebots/core/control";
import ControlInstallationPanel from "./ControlInstallationPanel.vue";
import { installationStorageKey } from "./control-installation-tracking.js";
const lock = vi.hoisted(() => vi.fn());
vi.mock("./control-installation-lock.js", () => ({ withInstallationTrackingLock: lock }));
vi.mock("../ui/UiInfoTip.vue", () => ({ default: { render: () => null } }));
vi.mock("./ControlAdapterCatalogBrowser.vue", () => ({ default: { render: () => null } }));
// 计划预览的字段展示不在此处测试；保留真实父组件的 v-model 与提交事件。
vi.mock("./ControlInstallPlanPreview.vue", async () => {
    const { defineComponent, h } = await import("vue");
    return {
        default: defineComponent({
            props: ["modelValue"],
            emits: ["update:modelValue", "install"],
            setup(props, { emit }) {
                return () =>
                    h("section", [
                        h("input", { value: props.modelValue }),
                        h(
                            "button",
                            { onClick: () => emit("update:modelValue", "fixture-private-token") },
                            "输入测试授权",
                        ),
                        h("button", { onClick: () => emit("install") }, "确认并安装"),
                    ]);
            },
        }),
    };
});
// 无 DOM 宿主不运行原生密码框指令；已确认操作仍使用真实组件验证按钮门禁。
vi.mock("./ControlInstallationOperation.vue", async importOriginal => {
    const { default: Operation } =
        await importOriginal<typeof import("./ControlInstallationOperation.vue")>();
    const { defineComponent, h } = await import("vue");
    return {
        default: defineComponent({
            inheritAttrs: false,
            setup(_props, { attrs }) {
                return () =>
                    attrs.operation
                        ? h(Operation as Component, attrs)
                        : h("input", { value: attrs.modelValue });
            },
        }),
    };
});
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

const unmounts: Array<() => void> = [];
afterEach(() => {
    unmounts.splice(0).forEach(unmount => unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});
const selection = { adapters: [], protocols: [], applications: [] };
const plan = {
    id: "a".repeat(64),
    planDigest: "b".repeat(64),
    selection,
    removed: selection,
    packages: [],
    peers: [],
    recommendations: [],
} as unknown as ControlInstallPlan;
const tracked = { id: "test-operation", planId: plan.id, planDigest: plan.planDigest };
async function settle() {
    for (let index = 0; index < 10; index++) {
        await Promise.resolve();
        await nextTick();
    }
}
async function fixture(record: string | null, blocked = false, secure = false) {
    let value = record;
    const storage = {
        getItem: () => value,
        setItem: vi.fn((_key: string, next: string) => {
            value = next;
        }),
        removeItem: vi.fn(() => {
            value = null;
        }),
    };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("location", { protocol: "http:", hostname: secure ? "localhost" : "192.0.2.10" });
    lock.mockImplementation((action: () => unknown) => Promise.resolve().then(action));
    const client = {
        installationCatalog: vi.fn(async () => ({
            selection,
            adapters: [],
            protocols: [],
            applications: [],
        })),
        planInstallation: vi.fn(async () => plan),
        install: vi.fn(async (input: { id: string }) => ({
            id: input.id,
            planDigest: plan.planDigest,
            phase: "verified",
            candidateId: "candidate",
        })),
        installation: vi.fn(async () => ({
            ...tracked,
            phase: "verified",
            candidateId: "candidate",
        })),
        activateGeneration: vi.fn(async () => ({ status: "succeeded" })),
    };
    const root = node("root");
    const app = renderer.createApp(ControlInstallationPanel, {
        client: client as unknown as ControlClient,
        category: "protocol",
        ...(blocked ? { mutationBlock: { title: "只读" } } : {}),
    });
    app.mount(root);
    let mounted = true;
    const unmount = () => {
        if (mounted) {
            app.unmount();
            mounted = false;
        }
    };
    unmounts.push(unmount);
    await settle();
    const button = (label: string) => {
        const found = flatten(root).find(item => item.tag === "button" && text(item) === label);
        if (!found) throw new Error(`找不到按钮：${label}`);
        return found;
    };
    const click = async (label: string) => {
        const handler = button(label).props.onClick as () => unknown;
        handler();
        await settle();
    };
    return { root, storage, client, button, click, unmount };
}
describe("安装面板提交边界", () => {
    it("损坏记录使页面保持只读，直接触发处理器也不能生成计划", async () => {
        const view = await fixture("{}");
        expect(text(view.root)).toContain("安装记录已损坏");
        expect(view.button("确认选择").props.disabled).toBe(true);
        expect(view.button("检查更新").props.disabled).toBe(true);
        await view.click("确认选择");
        expect(view.client.planInstallation).not.toHaveBeenCalled();
        expect(view.storage.getItem()).toBe("{}");
    });
    it("禁用状态下不能清除已完成操作，即使触发事件也保留记录", async () => {
        const view = await fixture(JSON.stringify(tracked), true);
        expect(view.button("准备下一次安装").props.disabled).toBe(true);
        await view.click("准备下一次安装");
        expect(view.storage.removeItem).not.toHaveBeenCalled();
    });
    it("计划确认后发现另一页的相同操作，复用编号而不创建新记录", async () => {
        const view = await fixture(null);
        await view.click("确认选择");
        view.storage.setItem(installationStorageKey, JSON.stringify(tracked));
        await view.click("确认并安装");
        expect(view.client.install).toHaveBeenCalledWith({ id: tracked.id, planId: plan.id });
        expect(view.storage.setItem).toHaveBeenCalledTimes(1);
    });
    it("本地存储 getter 被禁用时使用中文提示且不提交安装", async () => {
        const view = await fixture(null);
        await view.click("确认选择");
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get: () => {
                throw new DOMException("Access denied", "SecurityError");
            },
        });
        await view.click("确认并安装");
        expect(text(view.root)).toContain("本地存储");
        expect(text(view.root)).not.toContain("Access denied");
        expect(view.client.install).not.toHaveBeenCalled();
    });
    it("页面在等待锁时关闭，不创建未提交的操作记录", async () => {
        const view = await fixture(null);
        await view.click("确认选择");
        let release!: () => void;
        lock.mockImplementation(
            (action: () => unknown) =>
                new Promise(resolve => {
                    release = () => resolve(action());
                }),
        );
        await view.click("确认并安装");
        view.unmount();
        release();
        await settle();
        expect(view.storage.setItem).not.toHaveBeenCalled();
        expect(view.client.install).not.toHaveBeenCalled();
    });
    it("记录已写入而页面关闭时仍完成同编号提交", async () => {
        const view = await fixture(null);
        await view.click("确认选择");
        let release!: () => void;
        lock.mockImplementation(
            (action: () => unknown) =>
                new Promise(resolve => {
                    const result = action();
                    release = () => resolve(result);
                }),
        );
        await view.click("确认并安装");
        const record = JSON.parse(view.storage.getItem()!);
        view.unmount();
        release();
        await settle();
        expect(view.client.install).toHaveBeenCalledWith({ id: record.id, planId: plan.id });
        expect(view.storage.removeItem).not.toHaveBeenCalled();
    });
    it("持久化失败保留授权输入，重试提交后清空且不落盘", async () => {
        const view = await fixture(null, false, true);
        await view.click("确认选择");
        await view.click("输入测试授权");
        const inputValue = () => flatten(view.root).find(item => item.tag === "input")?.props.value;
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get: () => {
                throw new DOMException("Access denied", "SecurityError");
            },
        });
        await view.click("确认并安装");
        expect(inputValue()).toBe("fixture-private-token");
        expect(view.client.install).not.toHaveBeenCalled();
        vi.stubGlobal("localStorage", view.storage);
        // 返回未确认，留在操作视图，检查输入仍于提交前清空。
        view.client.install.mockRejectedValueOnce(new Error("network"));
        view.client.installation.mockRejectedValueOnce(new Error("network"));
        await view.click("确认并安装");
        expect(view.client.install).toHaveBeenCalledWith(
            expect.objectContaining({ token: "fixture-private-token" }),
        );
        expect(inputValue()).toBe("");
        expect(view.storage.getItem()).not.toContain("fixture-private-token");
    });
});
