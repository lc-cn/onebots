/** Pastel 路由与命令 application module 之间的统一执行适配器。 */
import { useEffect, useRef, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { CliError, type CommandResult } from "./command-application.js";
import { reserveMachineReadableStdout } from "./machine-readable-output.js";

/** Pastel 路由执行 application command 所需的最小接口。 */
export interface CommandRunnerProps {
    execute: () => CommandResult | Promise<CommandResult>;
    pending?: string;
    machineReadable?: boolean;
}

/** 执行命令并统一呈现等待、结果、错误与后续诊断建议。 */
export function CommandRunner({ execute, pending, machineReadable = false }: CommandRunnerProps) {
    const { stdout } = useStdout();
    const executeRef = useRef(execute);
    const [result, setResult] = useState<CommandResult>();
    const [error, setError] = useState<Error>();

    useEffect(() => {
        const stdoutBoundary = machineReadable ? reserveMachineReadableStdout() : null;
        const execution = () => Promise.resolve().then(executeRef.current);
        void execution()
            .then(value => {
                if (machineReadable && value.output) {
                    stdoutBoundary!.writeDocument(`${value.output}\n`);
                    setResult({ ...value, output: undefined });
                } else if (value.raw && value.output) {
                    process.stdout.write(`${value.output}\n`);
                    setResult({ ...value, output: undefined });
                } else {
                    setResult(value);
                }
                if (value.exitCode !== undefined) process.exitCode = value.exitCode;
            })
            .catch(reason => {
                const normalized = reason instanceof Error ? reason : new Error(String(reason));
                process.exitCode = normalized instanceof CliError ? normalized.exitCode : 1;
                if (machineReadable) {
                    process.stderr.write(`[onebots] ${normalized.message}\n`);
                    setResult({});
                } else {
                    setError(normalized);
                }
            });
    }, []);

    if (error)
        return (
            <Box flexDirection="column">
                <Text color="red">[onebots] {error.message}</Text>
                {!error.message.includes("onebots install") && (
                    <Text dimColor>建议：运行 onebots doctor 获取诊断信息</Text>
                )}
            </Box>
        );
    if (!result)
        return !machineReadable && stdout.isTTY && pending ? (
            <Text color="cyan">{pending}</Text>
        ) : null;
    return result.output ? <Text>{result.output}</Text> : null;
}
