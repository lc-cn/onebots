import { AdapterRegistry, ProtocolRegistry } from "@onebots/core";
import type { RuntimePluginSelection } from "../runtime-plugin-selection.js";
import { asRecord, editSchema } from "./form.js";
import { confirm, TuiCancelled, type TuiPrompt } from "./prompt.js";

/** 账号列表只修改传入草稿；协议页与账号页共享同一个编辑器。 */
export async function configureAccounts(
    prompt: TuiPrompt,
    config: Record<string, unknown>,
    selection: RuntimePluginSelection,
    protocolsOnly = false,
): Promise<void> {
    while (true) {
        const accounts = Object.keys(config).filter(key => /^[^.]+\..+$/u.test(key));
        const [action] = await prompt.ask({
            title: protocolsOnly ? "账号协议出口" : "平台账号",
            choices: [
                ...accounts.map(key => ({ value: `edit:${key}`, label: key })),
                ...(!protocolsOnly
                    ? selection.adapters.map(name => ({
                          value: `add:${name}`,
                          label: `＋ 添加 ${name} 账号`,
                      }))
                    : []),
                { value: "$done", label: "返回工作区" },
            ],
        });
        if (action === "$done") return;
        try {
            const oldKey = action.startsWith("edit:") ? action.slice(5) : undefined;
            const platform = oldKey ? oldKey.slice(0, oldKey.indexOf(".")) : action.slice(4);
            if (protocolsOnly && oldKey) {
                config[oldKey] = await editAccountProtocols(
                    prompt,
                    asRecord(config[oldKey]),
                    selection,
                    oldKey,
                );
                continue;
            }
            if (oldKey) {
                const [operation] = await prompt.ask({
                    title: oldKey,
                    choices: [
                        { value: "edit", label: "编辑账号信息" },
                        { value: "protocols", label: "配置协议出口" },
                        { value: "delete", label: "删除账号" },
                    ],
                });
                if (operation === "delete") {
                    if (
                        await confirm(
                            prompt,
                            `删除 ${oldKey}？`,
                            "最终保存前仍可在设置中放弃草稿。",
                        )
                    )
                        delete config[oldKey];
                    continue;
                }
                if (operation === "protocols") {
                    config[oldKey] = await editAccountProtocols(
                        prompt,
                        asRecord(config[oldKey]),
                        selection,
                        oldKey,
                    );
                    continue;
                }
            }
            const schema = AdapterRegistry.getSchema(platform);
            if (!schema) {
                prompt.report(`${platform} 的依赖尚未加载，请到扩展页安装或修复。`);
                continue;
            }
            const account = await editSchema(
                prompt,
                schema,
                {
                    ...asRecord(oldKey ? config[oldKey] : undefined),
                    ...(oldKey ? { account_id: oldKey.slice(platform.length + 1) } : {}),
                },
                platform,
            );
            const id = String(account.account_id ?? "").trim();
            if (!id) {
                prompt.report("账号标识不能为空");
                continue;
            }
            const key = `${platform}.${id}`;
            if (key !== oldKey && Object.hasOwn(config, key)) {
                prompt.report("账号已存在，请从列表中编辑。");
                continue;
            }
            delete account.account_id;
            config[key] = account;
            if (oldKey && key !== oldKey) delete config[oldKey];
            prompt.report("账号已加入草稿。可在协议页启用出口，再统一保存和启动。");
        } catch (error) {
            if (!(error instanceof TuiCancelled)) throw error;
        }
    }
}

async function editAccountProtocols(
    prompt: TuiPrompt,
    current: Record<string, unknown>,
    selection: RuntimePluginSelection,
    title: string,
): Promise<Record<string, unknown>> {
    if (!selection.protocols.length) {
        prompt.report("请先到扩展页选择输出协议。");
        return current;
    }
    const draft = current;
    while (true) {
        const [name] = await prompt.ask({
            title: `${title} / 协议`,
            choices: [
                ...selection.protocols.map(value => ({
                    value,
                    label: `${value} · ${Object.hasOwn(draft, value.replace("-", ".")) ? "已启用" : "未启用"}`,
                })),
                { value: "$done", label: "完成协议配置" },
            ],
        });
        if (name === "$done") return draft;
        try {
            const key = name.replace("-", ".");
            const [action] = await prompt.ask({
                title: name,
                choices: [
                    { value: "edit", label: "配置并启用" },
                    { value: "disable", label: "禁用出口" },
                ],
            });
            if (action === "disable") {
                delete draft[key];
                continue;
            }
            const schema = ProtocolRegistry.getSchema(key);
            if (!schema) throw new Error(`${name} 尚未加载，请先修复依赖`);
            draft[key] = await editSchema(
                prompt,
                schema,
                asRecord(draft[key]),
                `${title} / ${name}`,
            );
        } catch (error) {
            if (!(error instanceof TuiCancelled)) throw error;
        }
    }
}
