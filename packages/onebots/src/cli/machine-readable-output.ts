export interface MachineReadableStdoutBoundary {
    /** 绕过重定向，只向调用前的 stdout 写入最终机器文档。 */
    writeDocument(document: string): void;
    /** 测试或嵌入式调用显式释放；CLI 正常在进程退出时自动释放。 */
    restore(): void;
}

let activeBoundary: MachineReadableStdoutBoundary | null = null;

/**
 * 将 stdout 保留给一份最终机器文档，直到当前 CLI 进程退出。
 * 第三方插件的同步、异步和迟到普通输出全部转发到 stderr。
 */
export function reserveMachineReadableStdout(): MachineReadableStdoutBoundary {
    if (activeBoundary) return activeBoundary;
    const stdoutWrite = process.stdout.write;
    const stderrWrite = process.stderr.write;
    const redirect = ((chunk: string | Uint8Array, ...args: unknown[]) =>
        Reflect.apply(stderrWrite, process.stderr, [
            chunk,
            ...args,
        ])) as typeof process.stdout.write;
    let restored = false;
    const boundary: MachineReadableStdoutBoundary = {
        writeDocument(document) {
            if (restored) throw new Error("机器可读 stdout 边界已经释放");
            Reflect.apply(stdoutWrite, process.stdout, [document]);
        },
        restore() {
            if (restored) return;
            restored = true;
            process.off("exit", boundary.restore);
            process.stdout.write = stdoutWrite;
            if (activeBoundary === boundary) activeBoundary = null;
        },
    };
    activeBoundary = boundary;
    process.stdout.write = redirect;
    process.once("exit", boundary.restore);
    return boundary;
}
