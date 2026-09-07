import { useState } from "react";
import { Box, Text, useInput } from "ink";

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
}

export interface TuiPrompt {
    ask(request: PromptRequest): Promise<string[]>;
    report(message: string): void;
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
    const choices = request.choices;
    useInput((input, key) => {
        if (key.escape || (key.ctrl && input === "c")) return cancel();
        if (choices) {
            if (key.upArrow) setCursor(index => Math.max(0, index - 1));
            if (key.downArrow) setCursor(index => Math.min(choices.length - 1, index + 1));
            if (input === " " && request.multiple && choices[cursor]) {
                const item = choices[cursor].value;
                setSelected(values =>
                    values.includes(item) ? values.filter(v => v !== item) : [...values, item],
                );
            }
            if (key.return) complete(request.multiple ? selected : [choices[cursor]?.value ?? ""]);
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
            {request.detail && <Text>{request.detail}</Text>}
            {choices ? (
                choices.slice(offset, offset + 10).map((choice, index) => (
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
                Esc 返回/取消{choices ? ` (${cursor + 1}/${choices.length})` : ""}
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
