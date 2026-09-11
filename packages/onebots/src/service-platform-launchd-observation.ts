export interface LaunchdProcessGeneration {
    group: number;
    started: string;
}

export function rejectUnsafeLaunchdObservation(): never {
    throw new Error("无法安全确认 launchd 服务及其进程组状态");
}

export class LaunchdTransitionError extends Error {}
export class LaunchdObservationChangedError extends Error {}

export function launchdProcessExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        return rejectUnsafeLaunchdObservation();
    }
}

export function parseLaunchdFields(output: string, target: string): Map<string, string> {
    if (output.length > 262144 || /[\u0000\r]/.test(output)) rejectUnsafeLaunchdObservation();
    const lines = output.trimEnd().split("\n");
    if (lines.shift() !== `${target} = {` || lines.pop() !== "}") rejectUnsafeLaunchdObservation();
    const result = new Map<string, string>();
    // launchctl print 的嵌套环境/端点不能伪装成顶层状态。
    let depth = 1;
    for (const line of lines) {
        const match = /^\s*([a-z ]+) = (.*)$/.exec(line);
        if (depth === 1 && match && ["path", "state", "pid", "last exit code"].includes(match[1])) {
            if (result.has(match[1])) rejectUnsafeLaunchdObservation();
            result.set(match[1], match[2]);
        }
        if (line.trimEnd().endsWith("{")) depth++;
        if (line.trim() === "}") depth--;
        if (depth < 1) rejectUnsafeLaunchdObservation();
    }
    if (depth !== 1) rejectUnsafeLaunchdObservation();
    return result;
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
] as const;

export function parseLaunchdProcessGeneration(
    output: string,
    expectedPid: number,
): LaunchdProcessGeneration | null {
    if (output.length > 4096 || /[\u0000\r]/.test(output)) rejectUnsafeLaunchdObservation();
    const match =
        /^\s*([1-9][0-9]*)\s+([1-9][0-9]*)\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+([1-9]|[12][0-9]|3[01])\s+([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])\s+([0-9]{4})\s*$/.exec(
            output,
        );
    if (!match || Number(match[1]) !== expectedPid) rejectUnsafeLaunchdObservation();
    const group = Number(match[2]);
    if (!Number.isSafeInteger(group) || group > 2147483647) rejectUnsafeLaunchdObservation();
    if (group !== expectedPid || expectedPid <= 1) return null;
    const month = months.indexOf(match[4] as (typeof months)[number]);
    const day = Number(match[5]);
    const year = Number(match[9]);
    const date = new Date(Date.UTC(year, month, day));
    if (
        year < 1970 ||
        year > 9999 ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month ||
        date.getUTCDate() !== day ||
        weekdays[date.getUTCDay()] !== match[3]
    )
        rejectUnsafeLaunchdObservation();
    return {
        group,
        started: `${match[9]}${String(month + 1).padStart(2, "0")}${match[5].padStart(2, "0")}T${match[6]}${match[7]}${match[8]}`,
    };
}
