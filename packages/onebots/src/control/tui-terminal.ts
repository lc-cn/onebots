import readline from "node:readline/promises";
import type { TuiPrompt, PromptRequest } from "../tui/prompt.js";

export class ControlTuiCancelled extends Error {
    constructor() {
        super("已取消当前操作");
    }
}
export function createControlTerminalPrompt(): TuiPrompt {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("交互工作台需要终端");
    return {
        report(message) {
            process.stdout.write(`${message}\n`);
        },
        async ask(request) {
            process.stdout.write(`\n${request.title}\n`);
            if (request.detail) process.stdout.write(`${request.detail}\n`);
            if (request.secret) return [await secret()];
            if (request.choices)
                request.choices.forEach((choice, index) => {
                    const selected = request.selected?.includes(choice.value) ? " ✓" : "";
                    process.stdout.write(`${index + 1}. ${choice.label}${selected}\n`);
                });
            while (true) {
                const source = await question(request);
                if (source === ":q") throw new ControlTuiCancelled();
                if (!request.choices) return [source || request.initial || ""];
                if (request.multiple && source.trim() === "") return [...(request.selected ?? [])];
                if (request.multiple && source.trim() === "0") return [];
                const indexes = source
                    .trim()
                    .split(/[,，\s]+/)
                    .map(value => Number(value) - 1);
                if (
                    indexes.length &&
                    (request.multiple || indexes.length === 1) &&
                    indexes.every(
                        index =>
                            Number.isInteger(index) &&
                            index >= 0 &&
                            index < request.choices!.length,
                    )
                )
                    return [...new Set(indexes.map(index => request.choices![index].value))];
                process.stdout.write("请输入有效编号。\n");
            }
        },
    };
}
function question(request: PromptRequest): Promise<string> {
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve, reject) => {
        terminal.once("SIGINT", () => {
            terminal.close();
            reject(new ControlTuiCancelled());
        });
        terminal
            .question(
                request.multiple
                    ? "编号（逗号分隔，Enter保留，0清空，:q返回）："
                    : "输入（:q返回）：",
            )
            .then(
                value => {
                    terminal.close();
                    resolve(value);
                },
                () => {
                    terminal.close();
                    reject(new ControlTuiCancelled());
                },
            );
    });
}
function secret(): Promise<string> {
    return new Promise((resolve, reject) => {
        const input = process.stdin;
        const previous = input.isRaw;
        let value = "";
        const finish = (cancelled: boolean) => {
            input.removeListener("data", read);
            input.setRawMode(previous);
            input.pause();
            process.stdout.write("\n");
            if (cancelled) reject(new ControlTuiCancelled());
            else resolve(value);
            value = "";
        };
        const read = (bytes: Buffer) => {
            for (const character of bytes.toString("utf8")) {
                if (character === "\u0003" || character === "\u001b") {
                    finish(true);
                    return;
                }
                if (character === "\r" || character === "\n") {
                    finish(false);
                    return;
                }
                if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
                else if (/^[\x20-\x7e]$/.test(character)) value += character;
            }
        };
        process.stdout.write("凭据（隐藏输入，Enter跳过，Esc取消）：");
        input.setRawMode(true);
        input.resume();
        input.on("data", read);
    });
}
