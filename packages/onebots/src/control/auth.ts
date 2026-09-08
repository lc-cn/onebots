import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const FAILURE = "控制认证失败";
const BOOTSTRAP_TTL = 5 * 60 * 1000;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const ATTEMPT_WINDOW = 60 * 1000;
const ATTEMPT_LIMIT = 5;
const HASH = /^[a-f0-9]{64}$/;

export interface ControlAuthOptions {
    statePath: string;
    now?: () => number;
}

export interface ControlSession {
    id: string;
    issuedAt: number;
    expiresAt: number;
    current: boolean;
}

interface StoredSession {
    id: string;
    hash: string;
    issuedAt: number;
    expiresAt: number;
}

interface AuthState {
    version: 2;
    paired: boolean;
    deploymentBootstrap: { hash: string; expiresAt: number } | null;
    deploymentBootstrapHistory: string[];
    deploymentRecovery: { hash: string; expiresAt: number } | null;
    deploymentRecoveryHistory: string[];
    bootstrap: { hash: string; expiresAt: number } | null;
    recovery: { hash: string; expiresAt: number } | null;
    issuance: { startedAt: number; count: number };
    device: { hash: string; expiresAt: number } | null;
    sessions: StoredSession[];
    attempts: { startedAt: number; count: number };
}

/** 单个控制服务拥有状态文件；调用同步完成，不支持多个进程并行写入。 */
export class ControlAuth {
    private readonly statePath: string;
    private readonly now: () => number;
    private writeFailed = false;

    constructor(options: ControlAuthOptions) {
        this.statePath = path.resolve(options.statePath);
        this.now = options.now ?? Date.now;
        this.read();
    }

    /** 只能由受本地权限保护的控制入口调用，禁止公开为匿名 HTTP API。 */
    issueBootstrap(): string {
        const state = this.read();
        if (state.paired) throw new Error(FAILURE);
        return this.issue(state, "bootstrap");
    }

    /** 仅受信部署入口；一次性消费标记永久保留，不能替代本地恢复码。 */
    installDeploymentBootstrap(code: string): void {
        this.installDeployment(code, "bootstrap");
    }

    /** 已配对部署的显式恢复入口；仅成功兑换后替换当前浏览器会话。 */
    installDeploymentRecovery(code: string): void {
        this.installDeployment(code, "recovery");
    }

    private installDeployment(code: string, kind: "bootstrap" | "recovery"): void {
        if (
            typeof code !== "string" ||
            !/^[A-Za-z0-9_-]{43}$/.test(code) ||
            Buffer.from(code, "base64url").length !== 32 ||
            Buffer.from(code, "base64url").toString("base64url") !== code
        )
            throw new Error(FAILURE);
        const state = this.read();
        if (kind === "recovery" && !state.paired) throw new Error(FAILURE);
        const history =
            kind === "bootstrap"
                ? state.deploymentBootstrapHistory
                : state.deploymentRecoveryHistory;
        const otherHistory =
            kind === "bootstrap"
                ? state.deploymentRecoveryHistory
                : state.deploymentBootstrapHistory;
        const hash = digest(code);
        if (otherHistory.includes(hash)) throw new Error(FAILURE);
        if ((kind === "bootstrap" && state.paired) || history.includes(hash)) return;
        if (history.length >= 16)
            throw new Error("部署配对码轮换次数已达上限，请通过本机控制入口处理");
        const now = this.now();
        const replace =
            state[kind] === null ||
            history.includes(state[kind].hash) ||
            (kind === "recovery" && now >= state[kind].expiresAt);
        // 本地签发的 challenge 优先；部署注入只替换旧部署 challenge。
        const challenge = { hash, expiresAt: now + BOOTSTRAP_TTL };
        history.push(hash);
        if (kind === "bootstrap") state.deploymentBootstrap = challenge;
        else state.deploymentRecovery = challenge;
        this.writeDeployment(state); // 先持久消费，未知结果不得在重启后重新发码。
        if (!replace) return;
        state[kind] = challenge;
        this.writeDeployment(state);
    }

    /** 仅本地控制 socket 可调用；发码不撤销现有会话。 */
    issueRecovery(): string {
        const state = this.read();
        if (!state.paired) throw new Error(FAILURE);
        return this.issue(state, "recovery");
    }

    /** 仅本地控制入口签发；追加设备，不撤销已授权浏览器。 */
    issueDevice(): string {
        const state = this.read();
        if (!state.paired) throw new Error(FAILURE);
        return this.issue(state, "device");
    }

    private issue(state: AuthState, kind: "bootstrap" | "recovery" | "device"): string {
        const now = this.now();
        if (now >= state.issuance.startedAt + ATTEMPT_WINDOW)
            state.issuance = { startedAt: now, count: 0 };
        if (state.issuance.count >= ATTEMPT_LIMIT) throw new Error(FAILURE);
        state.issuance.count++;
        const code = randomBytes(24).toString("base64url");
        state[kind] = { hash: digest(code), expiresAt: now + BOOTSTRAP_TTL };
        this.write(state);
        return code;
    }

    pair(code: string): string {
        return this.pairWithRevocations(code).token;
    }

    pairWithRevocations(code: string): { token: string; revoked: string[] } {
        const state = this.read();
        const now = this.now();
        if (now >= state.attempts.startedAt + ATTEMPT_WINDOW) {
            state.attempts = { startedAt: now, count: 0 };
        }
        if (state.attempts.count >= ATTEMPT_LIMIT) throw new Error(FAILURE);
        state.attempts.count++;
        const append =
            state.paired &&
            state.device !== null &&
            now < state.device.expiresAt &&
            matches(code, state.device.hash);
        const challenge = append ? state.device : state.paired ? state.recovery : state.bootstrap;
        if (!challenge || now >= challenge.expiresAt || !matches(code, challenge.hash)) {
            this.write(state);
            throw new Error(FAILURE);
        }
        const revoked = state.sessions
            .filter(session => !append || now >= session.expiresAt)
            .map(session => session.hash);
        state.sessions = state.sessions.filter(session => now < session.expiresAt);
        if (append && state.sessions.length >= 16) {
            this.write(state);
            throw new Error("已授权设备已达上限，请先撤销不再使用的设备");
        }
        const token = randomBytes(32).toString("base64url");
        state.paired = true;
        state.bootstrap = null;
        state.device = null;
        if (!append) {
            state.recovery = null;
            state.sessions = [];
        }
        state.sessions.push({
            id: randomBytes(16).toString("hex"),
            hash: digest(token),
            issuedAt: now,
            expiresAt: now + SESSION_TTL,
        });
        this.write(state);
        return { token, revoked };
    }

    verify(token: string): boolean {
        return this.currentSession(this.read(), token) !== undefined;
    }

    sessions(token: string): ControlSession[] {
        const state = this.read();
        const current = this.currentSession(state, token);
        if (!current) throw new Error(FAILURE);
        const now = this.now();
        return state.sessions
            .filter(session => now >= session.issuedAt && now < session.expiresAt)
            .map(({ id, issuedAt, expiresAt }) => ({
                id,
                issuedAt,
                expiresAt,
                current: id === current.id,
            }));
    }

    revokeSession(token: string, id: string): string | null {
        const state = this.read();
        if (!this.currentSession(state, token)) throw new Error(FAILURE);
        if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) throw new Error(FAILURE);
        const target = state.sessions.find(session => session.id === id);
        if (!target) return null;
        state.sessions = state.sessions.filter(session => session.id !== id);
        this.write(state);
        return target.hash;
    }

    revoke(token: string): void {
        const state = this.read();
        const remaining = state.sessions.filter(session => !matches(token, session.hash));
        if (remaining.length === state.sessions.length) return;
        state.sessions = remaining;
        this.write(state);
    }

    private currentSession(state: AuthState, token: string): StoredSession | undefined {
        const now = this.now();
        return state.sessions.find(
            session =>
                now >= session.issuedAt && now < session.expiresAt && matches(token, session.hash),
        );
    }

    private read(): AuthState {
        if (this.writeFailed) throw new Error(FAILURE);
        try {
            const stat = fs.lstatSync(this.statePath);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) {
                throw new Error(FAILURE);
            }
            const state: unknown = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
            // 补齐旧结构，保留配对及限流；无签发时间的旧会话必须本机恢复。
            if (record(state)) {
                if (state.version === 1 && !Object.hasOwn(state, "sessionLifetime"))
                    state.sessionLifetime = null;
                if (!Object.hasOwn(state, "deploymentBootstrap")) state.deploymentBootstrap = null;
                if (!Object.hasOwn(state, "deploymentBootstrapHistory"))
                    state.deploymentBootstrapHistory = record(state.deploymentBootstrap)
                        ? [state.deploymentBootstrap.hash]
                        : [];
                if (!Object.hasOwn(state, "deploymentRecovery")) state.deploymentRecovery = null;
                if (!Object.hasOwn(state, "deploymentRecoveryHistory"))
                    state.deploymentRecoveryHistory = [];
                if (!Object.hasOwn(state, "recovery")) state.recovery = null;
                if (!Object.hasOwn(state, "issuance"))
                    state.issuance = { startedAt: this.now(), count: 0 };
            }
            if (record(state) && state.version === 1) {
                if (
                    Object.hasOwn(state, "sessions") ||
                    Object.hasOwn(state, "device") ||
                    !validLegacySession(state) ||
                    (!state.paired && state.sessionHash !== null)
                )
                    throw new Error(FAILURE);
                const lifetime = state.sessionLifetime;
                state.sessions =
                    typeof state.sessionHash === "string" && record(lifetime)
                        ? [
                              {
                                  id: digest(`device:${state.sessionHash}`).slice(0, 32),
                                  hash: state.sessionHash,
                                  issuedAt: lifetime.issuedAt,
                                  expiresAt: lifetime.expiresAt,
                              },
                          ]
                        : [];
                delete state.sessionHash;
                delete state.sessionLifetime;
                state.device = null;
                state.version = 2;
            }
            if (!validState(state)) throw new Error(FAILURE);
            return state;
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                return {
                    version: 2,
                    paired: false,
                    deploymentBootstrap: null,
                    deploymentBootstrapHistory: [],
                    deploymentRecovery: null,
                    deploymentRecoveryHistory: [],
                    bootstrap: null,
                    recovery: null,
                    issuance: { startedAt: this.now(), count: 0 },
                    device: null,
                    sessions: [],
                    attempts: { startedAt: this.now(), count: 0 },
                };
            }
            // 认证边界统一拒绝，不把磁盘内容或解析错误带入响应/日志。
            throw new Error(FAILURE);
        }
    }

    private writeDeployment(state: AuthState): void {
        try {
            this.write(state);
        } catch {
            this.writeFailed = true;
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

function validLegacySession(value: Record<string, unknown>): boolean {
    if (
        value.sessionHash !== null &&
        (typeof value.sessionHash !== "string" || !HASH.test(value.sessionHash))
    )
        return false;
    if (value.sessionLifetime !== null) {
        const lifetime = value.sessionLifetime;
        if (
            value.sessionHash === null ||
            !record(lifetime) ||
            typeof lifetime.issuedAt !== "number" ||
            !Number.isSafeInteger(lifetime.issuedAt) ||
            lifetime.issuedAt < 0 ||
            typeof lifetime.expiresAt !== "number" ||
            !Number.isSafeInteger(lifetime.expiresAt) ||
            lifetime.expiresAt - lifetime.issuedAt !== SESSION_TTL
        )
            return false;
    }
    return true;
}

function validState(value: unknown): value is AuthState {
    if (
        !record(value) ||
        value.version !== 2 ||
        typeof value.paired !== "boolean" ||
        Object.hasOwn(value, "sessionHash") ||
        Object.hasOwn(value, "sessionLifetime")
    )
        return false;
    if (
        !Array.isArray(value.sessions) ||
        value.sessions.length > 16 ||
        value.sessions.some(
            session =>
                !record(session) ||
                typeof session.id !== "string" ||
                !/^[a-f0-9]{32}$/.test(session.id) ||
                !validLegacySession({ sessionHash: session.hash, sessionLifetime: session }) ||
                session.hash === null,
        ) ||
        new Set(value.sessions.map(session => session.id)).size !== value.sessions.length ||
        new Set(value.sessions.map(session => session.hash)).size !== value.sessions.length
    )
        return false;
    for (const challenge of [
        value.bootstrap,
        value.recovery,
        value.device,
        value.deploymentBootstrap,
        value.deploymentRecovery,
    ]) {
        if (challenge === null) continue;
        if (
            !record(challenge) ||
            typeof challenge.hash !== "string" ||
            !HASH.test(challenge.hash) ||
            typeof challenge.expiresAt !== "number" ||
            !Number.isSafeInteger(challenge.expiresAt)
        )
            return false;
    }
    for (const [history, challenge] of [
        [value.deploymentBootstrapHistory, value.deploymentBootstrap],
        [value.deploymentRecoveryHistory, value.deploymentRecovery],
    ]) {
        if (
            !Array.isArray(history) ||
            history.length > 16 ||
            history.some(hash => typeof hash !== "string" || !HASH.test(hash)) ||
            new Set(history).size !== history.length ||
            (challenge !== null && (!record(challenge) || !history.includes(challenge.hash)))
        )
            return false;
    }
    const bootstrapHistory = value.deploymentBootstrapHistory;
    const recoveryHistory = value.deploymentRecoveryHistory;
    if (
        !Array.isArray(bootstrapHistory) ||
        !Array.isArray(recoveryHistory) ||
        bootstrapHistory.some(hash => recoveryHistory.includes(hash)) ||
        (!value.paired && (value.deploymentRecovery !== null || recoveryHistory.length > 0))
    )
        return false;
    if (value.paired ? value.bootstrap !== null : value.sessions.length !== 0) return false;
    if (!value.paired && (value.recovery !== null || value.device !== null)) return false;
    if (
        !record(value.issuance) ||
        !Number.isSafeInteger(value.issuance.startedAt) ||
        !Number.isInteger(value.issuance.count) ||
        typeof value.issuance.count !== "number" ||
        value.issuance.count < 0 ||
        value.issuance.count > ATTEMPT_LIMIT
    )
        return false;
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
