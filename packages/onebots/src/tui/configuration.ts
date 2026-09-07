import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import {
    AdapterRegistry,
    ProtocolRegistry,
    ConfigValidator,
    isValidationRule,
    writeConfigFileAtomic,
    type Schema,
    type ValidationRule,
} from "@onebots/core";
import { getAppConfigSchema } from "../config-schema.js";
import { ensureManagementCredentials } from "../management-credentials.js";
import { parseRuntimeConfig, validateRuntimeConfig } from "../runtime-config-validator.js";
import {
    setRuntimePluginSelection,
    type RuntimePluginSelection,
} from "../runtime-plugin-selection.js";
import { createBaseSetupConfig } from "../setup-config.js";
import { ensureRuntimeDataDirectory } from "../runtime-data-directory.js";
import { confirm, type TuiPrompt } from "./prompt.js";

export function readConfiguration(configPath: string): Record<string, unknown> {
    return fs.existsSync(configPath)
        ? parseRuntimeConfig(fs.readFileSync(configPath, "utf8"))
        : createBaseSetupConfig();
}

/** 字段级编辑；数组逐项维护，敏感字段不预填、不回显。 */
export async function editSchema(
    prompt: TuiPrompt,
    schema: Schema,
    current: Record<string, unknown>,
    title: string,
    root?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const result = structuredClone(current);
    const context = root ?? result;
    for (const [key, value] of Object.entries(schema)) {
        if (!isValidationRule(value)) {
            if (await confirm(prompt, `${title} · 配置 ${key}？`, "可选分组；返回保留现值。"))
                result[key] = await editSchema(
                    prompt,
                    value,
                    record(result[key]),
                    `${title}.${key}`,
                    context,
                );
            continue;
        }
        const condition = value.ui?.visibleWhen;
        if (condition && !condition.oneOf.some(item => item === getPath(context, condition.path)))
            continue;
        let existing = result[key];
        if (existing === undefined && value.default !== undefined)
            existing =
                typeof value.default === "function"
                    ? value.default()
                    : structuredClone(value.default);
        if (value.type === "array") {
            result[key] = await editArray(
                prompt,
                value,
                Array.isArray(existing) ? existing : [],
                `${title} · ${value.label ?? key}`,
            );
            continue;
        }
        while (true) {
            const detail = [
                value.description,
                value.min !== undefined ? `最小值/长度：${value.min}` : "",
                value.max !== undefined ? `最大值/长度：${value.max}` : "",
                value.required ? "必填" : "可选；留空保留现值",
                value.sensitive && existing !== undefined ? "已有凭据（隐藏），留空保留" : "",
            ]
                .filter(Boolean)
                .join("\n");
            const choices = value.choices?.map((choice, index) => ({
                value: String(index),
                label: choice.label,
            }));
            if (value.type === "boolean" && !choices) {
                const [answer] = await prompt.ask({
                    title: `${title} · ${value.label ?? key}`,
                    detail,
                    choices: [
                        {
                            value: "keep",
                            label: `保留：${existing === undefined ? "未设置" : String(existing)}`,
                        },
                        { value: "true", label: "启用" },
                        { value: "false", label: "禁用" },
                    ],
                });
                if (answer !== "keep") existing = answer === "true";
            } else {
                const [answer] = await prompt.ask({
                    title: `${title} · ${value.label ?? key}`,
                    detail,
                    ...(choices
                        ? {
                              choices: [
                                  {
                                      value: "keep",
                                      label: `保留：${value.sensitive ? "隐藏" : String(existing ?? "未设置")}`,
                                  },
                                  ...choices,
                              ],
                          }
                        : {
                              secret: value.sensitive,
                              initial: value.sensitive
                                  ? ""
                                  : existing === undefined
                                    ? ""
                                    : typeof existing === "object"
                                      ? JSON.stringify(existing)
                                      : String(existing),
                          }),
                });
                try {
                    if (choices) {
                        if (answer !== "keep") existing = value.choices[Number(answer)].value;
                    } else if (answer !== "")
                        existing =
                            value.type === "number"
                                ? Number(answer)
                                : value.type === "object"
                                  ? JSON.parse(answer)
                                  : answer;
                } catch {
                    prompt.report("格式无效，请重新输入（对象字段使用 JSON）。");
                    continue;
                }
            }
            try {
                ConfigValidator.validate({ [key]: existing }, { [key]: value });
                if (value.required && existing === "") throw new Error("必填");
                if (value.type === "number" && existing !== undefined && !Number.isFinite(existing))
                    throw new Error("数字无效");
                if (existing !== undefined) result[key] = existing;
                break;
            } catch {
                prompt.report(`${value.label ?? key} 未通过校验，请检查必填项、类型或取值范围。`);
            }
        }
    }
    return result;
}

async function editArray(
    prompt: TuiPrompt,
    rule: ValidationRule,
    initial: unknown[],
    title: string,
): Promise<unknown[]> {
    if (rule.choices && !rule.allowCustomValues) {
        const choices = rule.choices;
        const selected = await prompt.ask({
            title,
            multiple: true,
            selected: choices.flatMap((choice, index) =>
                initial.includes(choice.value) ? [String(index)] : [],
            ),
            choices: choices.map((choice, index) => ({
                value: String(index),
                label: choice.label,
            })),
        });
        return selected.map(index => choices[Number(index)].value);
    }
    const values = structuredClone(initial);
    while (true) {
        const [action] = await prompt.ask({
            title,
            detail: `${values.length} 项。${rule.description ?? ""}`,
            choices: [
                { value: "done", label: "完成，保留列表" },
                { value: "add", label: "添加一项" },
                ...values.map((_, index) => ({
                    value: String(index),
                    label: `删除第 ${index + 1} 项`,
                })),
            ],
        });
        if (action === "done") return values;
        if (action !== "add") {
            values.splice(Number(action), 1);
            continue;
        }
        if (rule.ui?.fields?.length) {
            values.push(
                await editSchema(
                    prompt,
                    Object.fromEntries(
                        rule.ui.fields.map(field => [
                            field.key,
                            { ...field, type: field.type ?? "string" },
                        ]),
                    ),
                    {},
                    title,
                ),
            );
        } else {
            const [item] = await prompt.ask({
                title: `${title} · 新增`,
                secret: rule.sensitive,
                detail: "输入一项字符串值；复杂结构请通过 Web 配置表单编辑。",
            });
            if (item) values.push(item);
        }
    }
}

function getPath(root: Record<string, unknown>, key: string): unknown {
    return key.split(".").reduce<unknown>((value, segment) => record(value)[segment], root);
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

export async function configureAccounts(
    prompt: TuiPrompt,
    config: Record<string, unknown>,
    selection: RuntimePluginSelection,
): Promise<void> {
    if (!selection.protocols.length) {
        prompt.report("尚未选择输出协议；添加账号前，请从安装菜单选择至少一种协议。");
    }
    while (true) {
        const accounts = Object.keys(config).filter(key =>
            selection.adapters.some(name => key.startsWith(`${name}.`)),
        );
        const [action] = await prompt.ask({
            title: "账号与协议配置",
            choices: [
                { value: "done", label: "完成配置" },
                ...(selection.protocols.length ? selection.adapters : []).map(name => ({
                    value: `add:${name}`,
                    label: `添加 ${name} 账号`,
                })),
                ...accounts.map(key => ({ value: `edit:${key}`, label: `编辑 ${key}` })),
            ],
        });
        if (action === "done") return;
        const editing = action.startsWith("edit:");
        const oldKey = editing ? action.slice(5) : undefined;
        const platform = editing ? oldKey.slice(0, oldKey.indexOf(".")) : action.slice(4);
        const schema = AdapterRegistry.getSchema(platform);
        if (!schema) throw new Error(`${platform} 未提供配置 Schema`);
        const current = oldKey ? record(config[oldKey]) : {};
        if (editing) {
            const [operation] = await prompt.ask({
                title: oldKey,
                choices: [
                    { value: "edit", label: "编辑账号与协议" },
                    { value: "delete", label: "从配置中删除账号" },
                ],
            });
            if (operation === "delete") {
                if (await confirm(prompt, `删除 ${oldKey}？`, "最终保存前不会修改配置文件。"))
                    delete config[oldKey];
                continue;
            }
        }
        const account = await editSchema(
            prompt,
            schema,
            { ...current, ...(oldKey ? { account_id: oldKey.slice(platform.length + 1) } : {}) },
            platform,
        );
        const accountId = String(account.account_id ?? "").trim();
        if (!accountId) {
            prompt.report("账号标识不能为空，请重新添加。");
            continue;
        }
        const newKey = `${platform}.${accountId}`;
        if (newKey !== oldKey && Object.hasOwn(config, newKey)) {
            prompt.report("该账号已存在，请选择编辑。");
            continue;
        }
        delete account.account_id;
        let enabled: string[];
        do {
            enabled = await prompt.ask({
                title: `${newKey} · 启用哪些协议？`,
                multiple: true,
                selected: selection.protocols.filter(name =>
                    Object.hasOwn(current, name.replace("-", ".")),
                ),
                choices: selection.protocols.map(name => ({ value: name, label: name })),
            });
            if (!enabled.length)
                prompt.report("账号至少需要一个协议出口，请勾选；Esc 可取消本次配置。");
        } while (!enabled.length);
        for (const name of selection.protocols) {
            const key = name.replace("-", ".");
            if (!enabled.includes(name)) {
                delete account[key];
                continue;
            }
            const protocolSchema = ProtocolRegistry.getSchema(key);
            if (!protocolSchema) throw new Error(`${name} 未提供配置 Schema`);
            account[key] = await editSchema(
                prompt,
                protocolSchema,
                record(current[key]),
                `${newKey} · ${key}`,
            );
        }
        config[newKey] = account;
        if (oldKey && oldKey !== newKey) delete config[oldKey];
    }
}

export async function configureRuntime(
    prompt: TuiPrompt,
    configPath: string,
    selection: RuntimePluginSelection,
): Promise<boolean> {
    const original = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : undefined;
    let config = readConfiguration(configPath);
    if (await confirm(prompt, "配置网关监听端口与日志？")) {
        const base = getAppConfigSchema().base;
        config = await editSchema(
            prompt,
            { port: base.port, path: base.path, log_level: base.log_level },
            config,
            "网关",
        );
    }
    await configureAccounts(prompt, config, selection);
    setRuntimePluginSelection(config, selection);
    config = ensureManagementCredentials(config).config;
    ConfigValidator.validate(config, getAppConfigSchema().base);
    validateRuntimeConfig(config);
    if (
        !(await confirm(
            prompt,
            "保存配置？",
            `路径：${configPath}\n已有文件会备份为 .bak。保存后可在管理菜单安装/重启服务。`,
        ))
    )
        return false;
    const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : undefined;
    if (current !== original) throw new Error("配置已被其他操作修改，请重新进入配置向导");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    ensureRuntimeDataDirectory(path.join(path.dirname(configPath), "data"));
    writeConfigFileAtomic(configPath, yaml.dump(config, { noRefs: true }), {
        backup: original !== undefined,
        mode: 0o600,
    });
    prompt.report("配置已保存。管理鉴权码位于配置文件 access_token；可安装服务后打开 Web 管理端。");
    return true;
}
