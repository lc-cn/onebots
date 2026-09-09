import { useState } from "react";
import { Box, Text, useInput } from "ink";

const TERMINAL_PAGES = [
    { id: "overview", label: "概览" },
    { id: "extensions", label: "扩展" },
    { id: "accounts", label: "账号" },
    { id: "protocols", label: "协议" },
    { id: "frameworks", label: "框架" },
    { id: "service", label: "运行" },
    { id: "settings", label: "设置" },
] as const;

export interface PromptChoice {
    value: string;
    label: string;
}

export interface PromptRequest {
    title: string;
    detail?: string;
    choices?: PromptChoice[];
    multiple?: boolean;
    selected?: string[];
    initial?: string;
    secret?: boolean;
    /** 工作区导航只在页面根部可用，避免编辑时跳页丢失字段。 */
    navigation?: boolean;
}

export interface TuiPrompt {
    ask(request: PromptRequest): Promise<string[]>;
    report(message: string): void;
    progress?(message: string): void;
    handoff?(binPath: string, args: string[], root: string): Promise<void>;
}

export class TuiCancelled extends Error {
    constructor() {
        super("已取消当前操作");
    }
}

/** 所有交互共用一个 Ink 输入边界，凭据不进入终端历史或摘要。 */
export function PromptView({
    request,
    complete,
    cancel,
}: {
    request: PromptRequest;
    complete(value: string[]): void;
    cancel(): void;
}) {
    const [cursor, setCursor] = useState(0);
    const [selected, setSelected] = useState(request.selected ?? []);
    const [value, setValue] = useState(request.initial ?? "");
    const [scroll, setScroll] = useState(0);
    const [search, setSearch] = useState("");
    const [searching, setSearching] = useState(false);
    const choices = request.choices;
    const filtered = choices?.filter(choice =>
        choice.label.toLowerCase().includes(search.toLowerCase()),
    );
    useInput((input, key) => {
        if (key.escape && (searching || search)) {
            setSearching(false);
            setSearch("");
            setCursor(0);
            return;
        }
        if (request.navigation && !searching && /^[1-7]$/.test(input))
            return complete(["$page:" + TERMINAL_PAGES[Number(input) - 1].id]);
        if (key.escape || (key.ctrl && input === "c")) return cancel();
        if (request.navigation && key.tab) return complete(["$next"]);
        if (key.pageDown) return setScroll(index => index + 8);
        if (key.pageUp) return setScroll(index => Math.max(0, index - 8));
        if (!choices && key.ctrl && input === "u") return setValue("");
        if (choices) {
            if (input === "/" && !searching) {
                setSearching(true);
                return;
            }
            if (searching) {
                if (key.return) {
                    setSearching(false);
                    return;
                }
                setCursor(0);
                if (key.backspace || key.delete) setSearch(value => value.slice(0, -1));
                else if (!key.ctrl && !key.meta) setSearch(value => value + input);
                return;
            }
            if (key.upArrow) setCursor(index => Math.max(0, index - 1));
            if (key.downArrow)
                setCursor(index => Math.max(0, Math.min(filtered.length - 1, index + 1)));
            if (input === " " && request.multiple && filtered[cursor]) {
                const item = filtered[cursor].value;
                setSelected(values =>
                    values.includes(item) ? values.filter(v => v !== item) : [...values, item],
                );
            }
            if (key.return && (request.multiple || filtered[cursor]))
                complete(request.multiple ? selected : [filtered[cursor].value]);
        } else {
            if (key.return) return complete([value]);
            if (key.backspace || key.delete) setValue(text => [...text].slice(0, -1).join(""));
            else if (
                !key.ctrl &&
                !key.meta &&
                !key.upArrow &&
                !key.downArrow &&
                !key.leftArrow &&
                !key.rightArrow
            )
                setValue(text => text + input.replace(/[\x00-\x1f\x7f]/gu, ""));
        }
    });
    const offset = Math.max(0, cursor - 7);
    return (
        <Box flexDirection="column">
            <Text bold color="cyan">
                {request.title}
            </Text>
            {request.detail && (
                <Text>
                    {request.detail
                        .split("\n")
                        .slice(
                            Math.min(scroll, Math.max(0, request.detail.split("\n").length - 8)),
                            Math.min(scroll, Math.max(0, request.detail.split("\n").length - 8)) +
                                8,
                        )
                        .join("\n")}
                </Text>
            )}
            {request.detail?.split("\n").length > 8 && <Text dimColor>PgUp/PgDn 滚动说明</Text>}
            {(searching || search) && (
                <Text color="yellow">
                    搜索：{search}
                    {searching ? "▏（Enter 完成）" : "（/ 修改）"}
                </Text>
            )}
            {choices ? (
                filtered.slice(offset, offset + 8).map((choice, index) => (
                    <Text key={choice.value} color={offset + index === cursor ? "cyan" : undefined}>
                        {offset + index === cursor ? "❯" : " "}{" "}
                        {request.multiple
                            ? selected.includes(choice.value)
                                ? "[✓] "
                                : "[ ] "
                            : ""}
                        {choice.label}
                    </Text>
                ))
            ) : (
                <Text>❯ {request.secret ? "•".repeat(Math.min(value.length, 24)) : value}▏</Text>
            )}
            <Text dimColor>
                {choices ? `↑↓ 选择${request.multiple ? " · 空格勾选" : ""} · ` : ""}Enter 确认 ·
                Esc 返回
                {choices
                    ? ` · / 搜索 (${Math.min(cursor + 1, filtered.length)}/${filtered.length})`
                    : ""}
                {request.navigation ? " · 1–7 跳页 · Tab 下一页" : ""}
            </Text>
        </Box>
    );
}

export async function confirm(prompt: TuiPrompt, title: string, detail?: string): Promise<boolean> {
    const [answer] = await prompt.ask({
        title,
        detail,
        choices: [
            { value: "no", label: "返回，不执行" },
            { value: "yes", label: "确认执行" },
        ],
    });
    return answer === "yes";
}
