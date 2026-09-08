import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const FAILURE = "控制认证失败";
const BOOTSTRAP_TTL = 5 * 60 * 1000;
const ATTEMPT_WINDOW = 60 * 1000;
const ATTEMPT_LIMIT = 5;
const HASH = /^[a-f0-9]{64}$/;

export interface ControlAuthOptions {
    statePath: string;
    now?: () => number;
}

interface AuthState {
    version: 1;
    paired: boolean;
    bootstrap: { hash: string; expiresAt: number } | null;
    sessionHash: string | null;
    attempts: { startedAt: number; count: number };
}

/** 单个控制服务拥有状态文件；调用同步完成，不支持多个进程并行写入。 */
export class ControlAuth {
    private readonly statePath: string;
    private readonly now: () => number;

    constructor(options: ControlAuthOptions) {
        this.statePath = path.resolve(options.statePath);
        this.now = options.now ?? Date.now;
        this.read();
    }

    /** 只能由受本地权限保护的控制入口调用，禁止公开为匿名 HTTP API。 */
    issueBootstrap(): string {
        const state = this.read();
        if (state.paired) throw new Error(FAILURE);
        const code = randomBytes(24).toString("base64url");
        state.bootstrap = { hash: digest(code), expiresAt: this.now() + BOOTSTRAP_TTL };
        this.write(state);
        return code;
    }

    pair(code: string): string {
        const state = this.read();
        const now = this.now();
        if (now >= state.attempts.startedAt + ATTEMPT_WINDOW) {
            state.attempts = { startedAt: now, count: 0 };
        }
        if (state.attempts.count >= ATTEMPT_LIMIT) throw new Error(FAILURE);
        state.attempts.count++;
        if (
            state.paired ||
            !state.bootstrap ||
            now >= state.bootstrap.expiresAt ||
            !matches(code, state.bootstrap.hash)
        ) {
            this.write(state);
            throw new Error(FAILURE);
        }
        const token = randomBytes(32).toString("base64url");
        state.paired = true;
        state.bootstrap = null;
        state.sessionHash = digest(token);
        this.write(state);
        return token;
    }

    verify(token: string): boolean {
        const state = this.read();
        return state.sessionHash !== null && matches(token, state.sessionHash);
    }

    revoke(token: string): void {
        const state = this.read();
        if (state.sessionHash === null || !matches(token, state.sessionHash)) return;
        state.sessionHash = null;
        this.write(state);
    }

    private read(): AuthState {
        try {
            const stat = fs.lstatSync(this.statePath);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) {
                throw new Error(FAILURE);
            }
            const state: unknown = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
            if (!validState(state)) throw new Error(FAILURE);
            return state;
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                return {
                    version: 1,
                    paired: false,
                    bootstrap: null,
                    sessionHash: null,
                    attempts: { startedAt: this.now(), count: 0 },
                };
            }
            // 认证边界统一拒绝，不把磁盘内容或解析错误带入响应/日志。
            throw new Error(FAILURE);
        }
    }

    private write(state: AuthState): void {
        const directory = path.dirname(this.statePath);
        const temporary = `${this.statePath}.${randomBytes(12).toString("hex")}.tmp`;
        let descriptor: number | undefined;
        try {
            fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
            descriptor = fs.openSync(temporary, "wx", 0o600);
            fs.writeFileSync(descriptor, JSON.stringify(state) + "\n");
            fs.fsyncSync(descriptor);
            fs.closeSync(descriptor);
            descriptor = undefined;
            fs.renameSync(temporary, this.statePath);
            // POSIX 上同步目录项，使返回成功的消费记录也能跨断电保存。
            if (process.platform !== "win32") {
                descriptor = fs.openSync(directory, "r");
                fs.fsyncSync(descriptor);
                fs.closeSync(descriptor);
                descriptor = undefined;
            }
        } catch {
            throw new Error(FAILURE);
        } finally {
            try {
                if (descriptor !== undefined) fs.closeSync(descriptor);
                fs.rmSync(temporary, { force: true });
            } catch {
                // 清理故障仍使用固定诊断，不泄漏状态路径或认证信息。
                throw new Error(FAILURE);
            }
        }
    }
}

function digest(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function matches(value: string, hash: string): boolean {
    return (
        typeof value === "string" &&
        value.length <= 128 &&
        timingSafeEqual(Buffer.from(digest(value), "hex"), Buffer.from(hash, "hex"))
    );
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validState(value: unknown): value is AuthState {
    if (!record(value) || value.version !== 1 || typeof value.paired !== "boolean") return false;
    if (
        value.sessionHash !== null &&
        (typeof value.sessionHash !== "string" || !HASH.test(value.sessionHash))
    )
        return false;
    if (value.bootstrap !== null) {
        if (
            !record(value.bootstrap) ||
            typeof value.bootstrap.hash !== "string" ||
            !HASH.test(value.bootstrap.hash) ||
            typeof value.bootstrap.expiresAt !== "number" ||
            !Number.isSafeInteger(value.bootstrap.expiresAt)
        )
            return false;
    }
    if (value.paired ? value.bootstrap !== null : value.sessionHash !== null) return false;
    return (
        record(value.attempts) &&
        typeof value.attempts.startedAt === "number" &&
        Number.isSafeInteger(value.attempts.startedAt) &&
        typeof value.attempts.count === "number" &&
        Number.isInteger(value.attempts.count) &&
        value.attempts.count >= 0 &&
        value.attempts.count <= ATTEMPT_LIMIT
    );
}
