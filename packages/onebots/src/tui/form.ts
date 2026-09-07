import { ConfigValidator, isValidationRule, type Schema, type ValidationRule } from "@onebots/core";
import { confirm, TuiCancelled, type TuiPrompt } from "./prompt.js";

export function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function readPath(root: Record<string, unknown>, key: string): unknown {
    return key.split(".").reduce<unknown>((value, segment) => asRecord(value)[segment], root);
}

function display(value: unknown, rule?: ValidationRule): string {
    if (value === undefined || value === "") return rule?.required ? "待填写 · 必填" : "未设置";
    if (rule?.sensitive) return "已设置 · 隐藏";
    if (Array.isArray(value)) return `${value.length} 项`;
    if (typeof value === "object") return "已配置";
    if (typeof value === "boolean") return value ? "启用" : "禁用";
    return String(value)
        .replace(/[\x00-\x1f\x7f]/gu, " ")
        .slice(0, 48);
}

/** 字段索引就是表单：可任意编辑、返回和清空，敏感字段只呈现状态。 */
export async function editSchema(
    prompt: TuiPrompt,
    schema: Schema,
    current: Record<string, unknown>,
    title: string,
    root?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const draft = structuredClone(current);
    for (const [key, rule] of Object.entries(schema)) {
        if (isValidationRule(rule) && draft[key] === undefined && rule.default !== undefined)
            draft[key] =
                typeof rule.default === "function" ? rule.default() : structuredClone(rule.default);
    }
    while (true) {
        const visible = Object.entries(schema).filter(([, rule]) => {
            if (!isValidationRule(rule) || !rule.ui?.visibleWhen) return true;
            const condition = rule.ui.visibleWhen;
            return condition.oneOf.some(value => value === readPath(root ?? draft, condition.path));
        });
        let field: string;
        try {
            [field] = await prompt.ask({
                title,
                detail: "选择字段编辑；完成后返回工作区草稿，尚不会写入配置文件。",
                choices: [
                    ...visible.map(([key, rule]) => ({
                        value: key,
                        label: `${isValidationRule(rule) ? (rule.label ?? key) : key}  ${display(draft[key], isValidationRule(rule) ? rule : undefined)}`,
                    })),
                    { value: "$done", label: "完成编辑" },
                ],
            });
        } catch (error) {
            if (!(error instanceof TuiCancelled)) throw error;
            if (JSON.stringify(draft) === JSON.stringify(current)) throw error;
            const [action] = await prompt
                .ask({
                    title: "当前表单有修改",
                    choices: [
                        { value: "edit", label: "继续编辑" },
                        { value: "done", label: "完成并保留到草稿" },
                        { value: "discard", label: "放弃本表单修改" },
                    ],
                })
                .catch(cancel => {
                    if (!(cancel instanceof TuiCancelled)) throw cancel;
                    return ["edit"];
                });
            if (action === "discard") throw error;
            if (action !== "done") continue;
            field = "$done";
        }
        if (field === "$done") {
            try {
                ConfigValidator.validate(draft, schema);
                return draft;
            } catch {
                prompt.report("还有字段未通过校验，请检查必填项与取值范围；草稿已保留。");
                continue;
            }
        }
        const rule = schema[field];
        if (!rule) continue;
        try {
            if (!isValidationRule(rule))
                draft[field] = await editSchema(
                    prompt,
                    rule,
                    asRecord(draft[field]),
                    `${title} / ${field}`,
                    root ?? draft,
                );
            else {
                const value = await editValue(prompt, rule, draft[field], rule.label ?? field);
                if (value === undefined) delete draft[field];
                else draft[field] = value;
            }
        } catch (error) {
            if (!(error instanceof TuiCancelled)) throw error;
        }
    }
}

async function editValue(
    prompt: TuiPrompt,
    rule: ValidationRule,
    current: unknown,
    title: string,
): Promise<unknown> {
    if (rule.type === "array")
        return editArray(prompt, rule, Array.isArray(current) ? current : [], title);
    if (rule.type === "object") return editObject(prompt, asRecord(current), title);
    let draft = current;
    while (true) {
        const choices =
            rule.choices ??
            (rule.type === "boolean"
                ? [
                      { value: true, label: "启用" },
                      { value: false, label: "禁用" },
                  ]
                : undefined);
        const [answer] = await prompt.ask({
            title,
            detail: [
                rule.description,
                rule.required ? "必填" : "留空清除该字段",
                rule.sensitive && current !== undefined
                    ? "已设置凭据。留空保留，输入新值替换；Esc 返回。"
                    : "",
                rule.min === undefined ? "" : `最小值/长度 ${rule.min}`,
                rule.max === undefined ? "" : `最大值/长度 ${rule.max}`,
            ]
                .filter(Boolean)
                .join("\n"),
            ...(choices
                ? {
                      choices: [
                          ...choices.map((choice, index) => ({
                              value: String(index),
                              label: choice.label,
                          })),
                          ...(!rule.required ? [{ value: "$clear", label: "清除设置" }] : []),
                      ],
                  }
                : { secret: rule.sensitive, initial: rule.sensitive ? "" : String(draft ?? "") }),
        });
        draft = choices
            ? answer === "$clear"
                ? undefined
                : choices[Number(answer)]?.value
            : answer === ""
              ? rule.sensitive
                  ? current
                  : undefined
              : rule.type === "number"
                ? Number(answer)
                : answer;
        try {
            if (rule.type === "number" && draft !== undefined && !Number.isFinite(draft))
                throw new Error("无效数字");
            if (rule.required && (draft === "" || draft === undefined)) throw new Error("必填");
            ConfigValidator.validate({ value: draft }, { value: rule });
            return draft;
        } catch {
            prompt.report("该值未通过校验，请按字段说明修改。");
        }
    }
}

async function editObject(
    prompt: TuiPrompt,
    current: Record<string, unknown>,
    title: string,
): Promise<Record<string, unknown>> {
    const draft = structuredClone(current);
    while (true) {
        const [key] = await prompt.ask({
            title,
            detail: "逐项编辑键值，无需手写 JSON。对象值统一隐藏。",
            choices: [
                ...Object.keys(draft).map(value => ({ value, label: `${value} · 已设置` })),
                { value: "$add", label: "添加字段" },
                { value: "$done", label: "完成" },
            ],
        });
        if (key === "$done") return draft;
        try {
            const name = key === "$add" ? (await prompt.ask({ title: "字段名称" }))[0].trim() : key;
            if (
                !name ||
                ["__proto__", "prototype", "constructor"].includes(name) ||
                name.startsWith("$")
            ) {
                prompt.report("字段名称无效");
                continue;
            }
            const [type] = await prompt.ask({
                title: name,
                choices: [
                    { value: "string", label: "文本" },
                    { value: "number", label: "数字" },
                    { value: "boolean", label: "布尔值" },
                    { value: "object", label: "对象" },
                    { value: "array", label: "列表" },
                    { value: "$delete", label: "删除字段" },
                ],
            });
            if (type === "$delete") {
                delete draft[name];
                continue;
            }
            if (!["string", "number", "boolean", "object", "array"].includes(type)) continue;
            const rule: ValidationRule = { type: type as ValidationRule["type"], sensitive: true };
            const value = await editValue(prompt, rule, draft[name], name);
            if (value !== undefined) draft[name] = value;
        } catch (error) {
            if (!(error instanceof TuiCancelled)) throw error;
        }
    }
}

async function editArray(
    prompt: TuiPrompt,
    rule: ValidationRule,
    current: unknown[],
    title: string,
): Promise<unknown[]> {
    if (rule.choices && !rule.allowCustomValues) {
        const choices = rule.choices;
        const selected = await prompt.ask({
            title,
            multiple: true,
            selected: choices.flatMap((choice, index) =>
                current.includes(choice.value) ? [String(index)] : [],
            ),
            choices: choices.map((choice, index) => ({
                value: String(index),
                label: choice.label,
            })),
        });
        return selected.map(index => choices[Number(index)].value);
    }
    const draft = structuredClone(current);
    while (true) {
        const [action] = await prompt.ask({
            title,
            choices: [
                ...draft.map((value, index) => ({
                    value: String(index),
                    label: `${index + 1}. ${display(value, rule)}`,
                })),
                { value: "$add", label: "添加一项" },
                { value: "$done", label: "完成列表" },
            ],
        });
        if (action === "$done") {
            try {
                ConfigValidator.validate({ value: draft }, { value: rule });
                return draft;
            } catch {
                prompt.report("列表不符合字段要求，请修改。");
                continue;
            }
        }
        const index = action === "$add" ? draft.length : Number(action);
        try {
            if (action !== "$add") {
                const [operation] = await prompt.ask({
                    title: `第 ${index + 1} 项`,
                    choices: [
                        { value: "edit", label: "编辑" },
                        { value: "delete", label: "删除" },
                    ],
                });
                if (operation === "delete") {
                    if (await confirm(prompt, "删除这一项？")) draft.splice(index, 1);
                    continue;
                }
            }
            if (rule.ui?.fields?.length) {
                const schema: Schema = Object.fromEntries(
                    rule.ui.fields.map(field => [
                        field.key,
                        {
                            ...field,
                            type: field.type ?? "string",
                            ...(field.visibleWhen
                                ? { ui: { visibleWhen: field.visibleWhen } }
                                : {}),
                        },
                    ]),
                );
                draft[index] = await editSchema(prompt, schema, asRecord(draft[index]), title);
            } else if (draft[index] && typeof draft[index] === "object")
                draft[index] = await editObject(prompt, asRecord(draft[index]), title);
            else {
                const [value] = await prompt.ask({
                    title: "列表项",
                    secret: rule.sensitive,
                    initial: rule.sensitive ? "" : String(draft[index] ?? ""),
                    detail: rule.description,
                });
                if (value) draft[index] = value;
            }
        } catch (error) {
            if (!(error instanceof TuiCancelled)) throw error;
        }
    }
}
