/** OneBots CLI 进程入口的参数规范化 seam。 */

const REMOVED_NAMESPACES = new Set(["gateway", "service", "daemon"]);

const RUNTIME_OPTIONS = new Set([
    "-c",
    "--config",
    "-r",
    "--register",
    "-p",
    "--protocol",
    "-t",
    "--target",
]);

export type CliInvocation =
    | { kind: "cli"; argv: string[] }
    | { kind: "service-runtime"; argv: string[] }
    | { kind: "unknown"; command: string }
    | { kind: "invalid"; message: string };

/**
 * Pastel 将选项归属于具体文件路由。这个适配器保留 OneBots v1/v2 允许
 * `-r/-p/-c` 出现在命令名前后的兼容约定，并隔离系统服务的无 TTY 入口。
 */
export function prepareCliInvocation(argv: string[]): CliInvocation {
    const invalidOption = findInvalidRuntimeOption(argv.slice(2));
    if (invalidOption) return { kind: "invalid", message: invalidOption };

    const serviceRuntimeIndex = argv.indexOf("--service-runtime", 2);
    if (serviceRuntimeIndex >= 0) {
        return {
            kind: "service-runtime",
            argv: argv.filter((_, index) => index !== serviceRuntimeIndex),
        };
    }

    const firstPositional = findFirstPositional(argv);
    if (!firstPositional) {
        const trailing = argv.slice(2);
        const rootOnly =
            trailing.length > 0 &&
            trailing.every(token => ["-h", "--help", "-v", "--version"].includes(token));
        return rootOnly
            ? { kind: "cli", argv }
            : { kind: "cli", argv: [argv[0], argv[1], "run", ...argv.slice(2)] };
    }
    if (REMOVED_NAMESPACES.has(firstPositional.token))
        return { kind: "unknown", command: firstPositional.token };
    const routeIndex = firstPositional.index;

    const prefix = argv.slice(2, routeIndex);
    const { runtime, remaining } = splitRuntimeOptions(prefix);
    const local = splitRuntimeOptions(argv.slice(routeIndex + 1));
    return {
        kind: "cli",
        argv: [
            argv[0],
            argv[1],
            ...remaining,
            argv[routeIndex],
            ...local.remaining,
            ...runtime,
            ...local.runtime,
        ],
    };
}

function findInvalidRuntimeOption(tokens: string[]): string | undefined {
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (RUNTIME_OPTIONS.has(token)) {
            const value = tokens[++index];
            if (value === undefined || value.startsWith("-")) return `${token} 缺少参数`;
        } else if (/^--(?:config|register|protocol|target)=$/u.test(token)) {
            return `${token.slice(0, -1)} 缺少参数`;
        }
    }
    return undefined;
}

function findFirstPositional(argv: string[]): { index: number; token: string } | undefined {
    for (let index = 2; index < argv.length; index++) {
        const token = argv[index];
        if (RUNTIME_OPTIONS.has(token)) {
            index++;
            continue;
        }
        if (isAttachedRuntimeOption(token) || token.startsWith("-")) continue;
        return { index, token };
    }
    return undefined;
}

function splitRuntimeOptions(tokens: string[]): { runtime: string[]; remaining: string[] } {
    const runtime: string[] = [];
    const remaining: string[] = [];
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (RUNTIME_OPTIONS.has(token)) {
            runtime.push(token);
            if (tokens[index + 1] !== undefined) runtime.push(tokens[++index]);
        } else if (isAttachedRuntimeOption(token)) {
            runtime.push(token);
        } else {
            remaining.push(token);
        }
    }
    return { runtime, remaining };
}

function isAttachedRuntimeOption(token: string): boolean {
    return /^(?:--(?:config|register|protocol|target)=|-[crpt].+)/u.test(token);
}
