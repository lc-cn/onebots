import { randomUUID } from "node:crypto";
import type { ControlClient, ControlConfigurationDraft } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";
import { confirmControlAction } from "./tui-installation.js";
import { editControlFields, record } from "./tui-configuration-fields.js";

export async function trackControlConfiguration(
    client: ControlClient,
    prompt: TuiPrompt,
    id: string,
): Promise<void> {
    while (true) {
        let operation;
        try {
            operation = await client.configurationOperation(id);
        } catch {
            prompt.report(`应用任务 ${id} 结果暂不可确认；请查询原 ID，不重复提交。`);
            return;
        }
        prompt.report(
            `应用任务 ${id}：${operation.status} / ${operation.phase}${operation.rolledBack ? "（已回滚）" : ""}${operation.recoveryRequired ? "（需要恢复检查）" : ""}`,
        );
        if (operation.status !== "running") return;
        if (
            (
                await prompt.ask({
                    title: "配置应用处理中",
                    choices: [
                        { value: "refresh", label: "刷新原任务" },
                        { value: "back", label: "返回菜单" },
                    ],
                })
            )[0] === "back"
        )
            return;
    }
}
export async function runControlConfiguration(
    client: ControlClient,
    prompt: TuiPrompt,
): Promise<void> {
    const [mode] = await prompt.ask({
        title: "配置草稿",
        choices: [
            { value: "new", label: "从当前配置创建草稿" },
            { value: "resume", label: "继续已有草稿" },
            { value: "operation", label: "查询配置应用任务" },
            { value: "back", label: "返回" },
        ],
    });
    if (mode === "back") return;
    if (mode === "operation") {
        const [id] = await prompt.ask({ title: "输入配置应用任务 ID" });
        if (/^[a-zA-Z0-9_-]{1,128}$/.test(id ?? ""))
            await trackControlConfiguration(client, prompt, id);
        return;
    }
    let schemas: Record<string, unknown>;
    let draft: ControlConfigurationDraft;
    if (mode === "resume") {
        const [id] = await prompt.ask({ title: "输入草稿 ID" });
        ({ draft, schemas } = await client.configurationDraftContext(id));
    } else {
        const source = await client.configurationSource();
        if (source.state === "damaged") {
            if (
                !(await confirmControlAction(
                    prompt,
                    "原配置损坏：确认创建修复草稿？",
                    "管理服务将先保存原始配置的私有备份，再建立空配置草稿；不会猜测旧账号或协议。只有验证并确认应用后才替换原文件。",
                ))
            )
                return;
            ({ draft, schemas } = await client.createConfigurationRepairDraft(source.base));
        } else if (source.state === "ready") {
            const snapshot = await client.configurationSnapshot();
            schemas = snapshot.schemas;
            draft = await client.createConfigurationDraft(snapshot.base);
        } else throw new Error("配置源状态不可确认");
    }
    prompt.report(`草稿 ID：${draft.id}。修改仅保存到草稿，验证并确认应用后才影响网关。`);
    while (true) {
        const [action] = await prompt.ask({
            title: "账号与协议配置",
            choices: [
                { value: "base", label: "网关与扩展开关" },
                { value: "add", label: "添加平台账号" },
                { value: "account", label: "编辑账号字段" },
                { value: "remove", label: "删除平台账号" },
                { value: "protocol", label: "启用或停用协议出口" },
                { value: "protocol-fields", label: "编辑协议字段" },
                { value: "validate", label: "验证并应用草稿" },
                { value: "reload", label: "重新读取此草稿" },
                { value: "back", label: "返回，保留草稿" },
            ],
        });
        if (action === "back") return;
        try {
            if (action === "reload") {
                ({ draft, schemas } = await client.configurationDraftContext(draft.id));
                continue;
            }
            if (action === "base")
                draft = await editControlFields(client, prompt, draft, record(schemas.base), []);
            else if (action === "add") {
                const [platform] = await prompt.ask({
                    title: "选择已安装的平台",
                    choices: Object.keys(record(schemas.adapters)).map(name => ({
                        value: name,
                        label: name,
                    })),
                });
                if (!Object.hasOwn(record(schemas.adapters), platform)) continue;
                const [accountId] = await prompt.ask({
                    title: "输入账号 ID",
                    detail: "添加账号不会自动启用协议。",
                });
                if (await confirmControlAction(prompt, "确认添加账号到草稿？"))
                    draft = await client.addConfigurationAccount(draft.id, {
                        expectedRevision: draft.revision,
                        platform,
                        accountId,
                    });
            } else if (action === "account" || action === "remove") {
                const accountKey = await account(prompt, draft, schemas);
                if (!accountKey) continue;
                if (action === "remove") {
                    if (await confirmControlAction(prompt, "确认从草稿删除此账号及其协议配置？"))
                        draft = await client.removeConfigurationAccount(draft.id, {
                            expectedRevision: draft.revision,
                            accountKey,
                        });
                } else {
                    const platform = Object.keys(record(schemas.adapters)).find(name =>
                        accountKey.startsWith(`${name}.`),
                    )!;
                    draft = await editControlFields(
                        client,
                        prompt,
                        draft,
                        Object.fromEntries(
                            Object.entries(record(record(schemas.adapters)[platform])).filter(
                                ([key]) => key !== "account_id",
                            ),
                        ),
                        [accountKey],
                    );
                }
            } else if (action === "protocol" || action === "protocol-fields") {
                const [scope] = await prompt.ask({
                    title: "协议配置范围",
                    choices: [
                        { value: "account", label: "指定账号" },
                        { value: "general", label: "协议公共默认值" },
                        { value: "back", label: "返回" },
                    ],
                });
                if (scope === "back") continue;
                const accountKey =
                    scope === "general" ? null : await account(prompt, draft, schemas);
                if (scope !== "general" && !accountKey) continue;
                const [protocol] = await prompt.ask({
                    title: "选择已安装协议",
                    choices: Object.keys(record(schemas.protocols)).map(name => ({
                        value: name,
                        label: name,
                    })),
                });
                if (!Object.hasOwn(record(schemas.protocols), protocol)) continue;
                if (action === "protocol") {
                    const [choice] = await prompt.ask({
                        title: "协议出口",
                        choices: [
                            { value: "back", label: "保留不变" },
                            { value: "enable", label: "明确启用此协议" },
                            { value: "disable", label: "停用此协议" },
                        ],
                    });
                    if (
                        choice !== "back" &&
                        (await confirmControlAction(prompt, "确认修改协议配置？"))
                    )
                        draft = await client.setConfigurationProtocol(draft.id, {
                            expectedRevision: draft.revision,
                            accountKey,
                            protocol,
                            enabled: choice === "enable",
                        });
                } else {
                    const prefix = [accountKey ?? "general", protocol];
                    if (!Object.hasOwn(record(draft.document[prefix[0]]), protocol)) {
                        prompt.report("请先明确启用该协议，再编辑字段。");
                        continue;
                    }
                    draft = await editControlFields(
                        client,
                        prompt,
                        draft,
                        record(record(schemas.protocols)[protocol]),
                        prefix,
                    );
                }
            } else if (action === "validate") {
                const validation = await client.validateConfigurationDraft(
                    draft.id,
                    draft.revision,
                );
                if (!validation.valid || !validation.receiptId) {
                    prompt.report(
                        `草稿未通过验证，存在 ${validation.issues.length} 项字段问题。请检查字段后重新验证。`,
                    );
                    for (const issue of validation.issues) {
                        const location = issue.path.join(" / ").replace(/[\x00-\x1f\x7f]/gu, " ");
                        prompt.report(`${location || "配置"}：字段无效`);
                    }
                    continue;
                }
                if (validation.draftRevision !== draft.revision) {
                    prompt.report("草稿版本已变化，请重新读取并验证。");
                    continue;
                }
                if (
                    !(await confirmControlAction(
                        prompt,
                        "确认应用已验证草稿？",
                        "将按当前网关启停意图应用；运行中的网关可能重启。",
                    ))
                )
                    continue;
                const id = randomUUID();
                prompt.report(`配置应用任务：${id}`);
                try {
                    await client.applyConfiguration(id, validation.receiptId);
                } catch {
                    prompt.report("提交结果暂不可确认，查询原任务，不重新提交。");
                }
                await trackControlConfiguration(client, prompt, id);
                return;
            }
        } catch {
            prompt.report(
                `操作取消、冲突或结果暂不可确认。草稿 ${draft.id} 已保留；请重新读取，不自动重试。`,
            );
        }
    }
}
async function account(
    prompt: TuiPrompt,
    draft: ControlConfigurationDraft,
    schemas: Record<string, unknown>,
): Promise<string | null> {
    const names = Object.keys(draft.document).filter(key =>
        Object.keys(record(schemas.adapters)).some(platform => key.startsWith(`${platform}.`)),
    );
    const [selected] = await prompt.ask({
        title: "选择账号",
        choices: [
            ...names.map(name => ({ value: name, label: name })),
            { value: "", label: "返回" },
        ],
    });
    return names.includes(selected) ? selected : null;
}
