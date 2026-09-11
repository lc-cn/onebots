import type { ControlClient, ControlConfigurationDraft } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";
import { confirmControlAction } from "./tui-installation.js";
export const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
interface Field {
    path: string[];
    rule: Record<string, unknown>;
    list?: boolean;
}
function fields(
    schema: Record<string, unknown>,
    prefix: string[],
    document: unknown,
    depth = 0,
): Field[] {
    if (depth > 30) return [];
    return Object.entries(schema).flatMap(([key, value]) => {
        const rule = record(value);
        const path = [...prefix, key];
        if (rule.sensitive === true) return [{ path, rule }];
        if (rule.type === "object" && rule.properties)
            return fields(record(rule.properties), path, document, depth + 1);
        if (rule.type === "array") {
            let items = record(rule.items);
            const rows = record(rule.ui).fields;
            if (!rule.items && Array.isArray(rows))
                items = {
                    type: "object",
                    properties: Object.fromEntries(
                        rows.map(value => {
                            const item = record(value);
                            return [String(item.key), { type: "string", ...item }];
                        }),
                    ),
                };
            if (items.type === "object" && items.properties) {
                const current = at(document, path);
                const length = Array.isArray(current) ? current.length : 0;
                return [
                    { path, rule, list: true },
                    ...Array.from({ length: length }, (_, index) =>
                        fields(
                            record(items.properties),
                            [...path, String(index)],
                            document,
                            depth + 1,
                        ),
                    ).flat(),
                ];
            }
        }
        return typeof rule.type === "string"
            ? [{ path, rule }]
            : fields(rule, path, document, depth + 1);
    });
}
function at(document: unknown, path: string[]): unknown {
    return path.reduce<unknown>(
        (value, key) =>
            value && typeof value === "object"
                ? Object.getOwnPropertyDescriptor(value, key)?.value
                : undefined,
        document,
    );
}
const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((key, index) => key === b[index]);
export async function editControlFields(
    client: ControlClient,
    prompt: TuiPrompt,
    draft: ControlConfigurationDraft,
    schema: Record<string, unknown>,
    prefix: string[],
): Promise<ControlConfigurationDraft> {
    while (true) {
        const available = fields(schema, prefix, draft.document).filter(
            field =>
                !draft.secretStates.some(
                    state =>
                        state.path.length < field.path.length &&
                        state.path.every((segment, index) => field.path[index] === segment),
                ),
        );
        const [selected] = await prompt.ask({
            title: "编辑草稿字段",
            detail: "仅编辑服务端草稿；未知字段保留，敏感值不会显示。",
            choices: [
                ...available.map((field, index) => {
                    const secret =
                        field.rule.sensitive === true ||
                        draft.secretStates.some(state => same(state.path, field.path));
                    const present = secret
                        ? draft.secretStates.some(
                              state => same(state.path, field.path) && state.configured,
                          )
                        : at(draft.document, field.path) !== undefined;
                    return {
                        value: String(index),
                        label: `${field.path.join(" / ")} · ${String(field.rule.label ?? field.path.at(-1))} · ${present ? "已设置" : "未设置"}${secret ? "（隐藏）" : ""}`,
                    };
                }),
                { value: "back", label: "完成字段编辑" },
            ],
        });
        if (selected === "back") return draft;
        const field = available[Number(selected)];
        if (!field) continue;
        if (field.list) {
            const [action] = await prompt.ask({
                title: "对象列表",
                detail: "使用服务端列表操作，保留未知字段，不读取或重写整表秘密。",
                choices: [
                    { value: "back", label: "返回" },
                    { value: "append", label: "添加空条目" },
                    { value: "remove", label: "删除条目" },
                ],
            });
            if (action === "append") {
                if (await confirmControlAction(prompt, "确认添加空列表条目？"))
                    draft = await client.editConfigurationList(draft.id, {
                        expectedRevision: draft.revision,
                        path: field.path,
                        action: "append",
                    });
            } else if (action === "remove") {
                const entries = at(draft.document, field.path);
                const [index] = await prompt.ask({
                    title: "删除哪一项",
                    choices: [
                        ...(Array.isArray(entries)
                            ? entries.map((_, index) => ({
                                  value: String(index),
                                  label: `第 ${index + 1} 项`,
                              }))
                            : []),
                        { value: "back", label: "返回" },
                    ],
                });
                if (
                    index !== "back" &&
                    Array.isArray(entries) &&
                    Number.isInteger(Number(index)) &&
                    Number(index) >= 0 &&
                    Number(index) < entries.length &&
                    (await confirmControlAction(prompt, "确认删除此条目及其秘密字段？"))
                )
                    draft = await client.editConfigurationList(draft.id, {
                        expectedRevision: draft.revision,
                        path: field.path,
                        action: "remove",
                        index: Number(index),
                    });
            }
            continue;
        }
        const secret =
            field.rule.sensitive === true ||
            draft.secretStates.some(state => same(state.path, field.path));
        const [action] = await prompt.ask({
            title: String(field.rule.label ?? field.path.at(-1)),
            choices: [
                { value: "keep", label: "保留原值" },
                { value: "set", label: "设置新值" },
                { value: "clear", label: "清空此字段" },
            ],
        });
        if (action === "keep") {
            if (secret)
                draft = await client.editConfigurationDraft(draft.id, {
                    expectedRevision: draft.revision,
                    changes: [],
                    secrets: [{ op: "keep", path: field.path }],
                });
            continue;
        }
        if (action === "clear") {
            if (!(await confirmControlAction(prompt, "确认清空字段？"))) continue;
            draft = await client.editConfigurationDraft(draft.id, {
                expectedRevision: draft.revision,
                changes: secret ? [] : [{ op: "remove", path: field.path }],
                secrets: secret ? [{ op: "clear", path: field.path }] : [],
            });
            continue;
        }
        if (action !== "set") continue;
        let value: unknown;
        const choices = Array.isArray(field.rule.choices) ? field.rule.choices : undefined;
        if (!secret && field.rule.type === "boolean") {
            value =
                (
                    await prompt.ask({
                        title: "选择布尔值",
                        choices: [
                            { value: "true", label: "是" },
                            { value: "false", label: "否" },
                        ],
                    })
                )[0] === "true";
        } else if (!secret && choices && field.rule.type !== "array") {
            const [index] = await prompt.ask({
                title: "选择字段值",
                choices: choices.map((entry, index) => ({
                    value: String(index),
                    label: String(record(entry).label ?? record(entry).value),
                })),
            });
            value = record(choices[Number(index)]).value;
        } else {
            const [input] = await prompt.ask({
                title: `输入${field.rule.type === "object" || field.rule.type === "array" ? " JSON" : "新值"}`,
                secret,
                detail: secret
                    ? "隐藏输入；不提供旧值。取消可返回，空字符串将作为新值。"
                    : "不自动填入默认值；格式和业务约束由服务端验证。",
            });
            try {
                value =
                    field.rule.type === "number"
                        ? input.trim()
                            ? Number(input)
                            : NaN
                        : field.rule.type === "object" || field.rule.type === "array"
                          ? JSON.parse(input)
                          : input;
                if (field.rule.type === "number" && !Number.isFinite(value)) throw new Error();
                if (field.rule.type === "array" && !Array.isArray(value)) throw new Error();
                if (
                    field.rule.type === "object" &&
                    (!value || typeof value !== "object" || Array.isArray(value))
                )
                    throw new Error();
            } catch {
                prompt.report("输入格式无效，字段未修改。");
                continue;
            }
        }
        draft = await client.editConfigurationDraft(draft.id, {
            expectedRevision: draft.revision,
            changes: secret ? [] : [{ op: "set", path: field.path, value }],
            secrets: secret ? [{ op: "set", path: field.path, value }] : [],
        });
        value = undefined;
    }
}
