import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9-]{36}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
const CANDIDATE = "candidate.json";
const RECEIPT = "receipt.json";
const LOCK = "pnpm-lock.yaml";
const SCHEMAS = "schemas.json";
const CHECKS = [
    "packageIdentity",
    "peerDependencies",
    "singleHost",
    "loadRegistration",
    "schemas",
] as const;

export interface GenerationCandidate {
    id: string;
    directory: string;
    operationId: string;
    planDigest: string;
}

export interface GenerationVerification {
    planDigest: string;
    hostVersion: string;
    coreVersion: string;
    nodeAbi: string;
    platform: NodeJS.Platform;
    arch: string;
    checks: Record<(typeof CHECKS)[number], true>;
}

export interface GenerationReceipt extends GenerationVerification {
    schemaVersion: 1;
    phase: "verified";
    id: string;
    storeId: string;
    operationId: string;
    verifiedAt: string;
    lockDigest: string;
    schemasDigest: string;
    hostManifestDigest: string;
    coreManifestDigest: string;
}

export interface VerifiedGeneration extends GenerationCandidate {
    receipt: GenerationReceipt;
}

export interface GenerationStoreOptions {
    root: string;
    /** 由控制服务提供；须与激活操作在同一个工作区锁内串行调用。 */
    isActive(id: string): boolean;
}

interface CandidateRecord {
    schemaVersion: 1;
    phase: "candidate";
    id: string;
    storeId: string;
    operationId: string;
    planDigest: string;
}

/**
 * 只负责候选目录及验证收据，不拥有激活指针、不执行下载/插件代码。
 * 锁文件与 Schema 摘要不证明 node_modules 内容不可变；控制目录必须由可信用户独占，
 * installer 不得改写已验证版本。恶意插件隔离与 OS 权限是上层责任。
 * 构造及所有变更必须在控制服务持有的工作区锁内串行执行。
 */
export class GenerationStore {
    private readonly root: string;
    private readonly storeId: string;
    private readonly isActive: (id: string) => boolean;

    constructor(options: GenerationStoreOptions) {
        fs.mkdirSync(options.root, { recursive: true, mode: 0o700 });
        if (fs.lstatSync(options.root).isSymbolicLink()) throw new Error("版本仓库不能是符号链接");
        this.root = fs.realpathSync(options.root);
        fs.chmodSync(this.root, 0o700);
        this.isActive = options.isActive;
        const identityPath = path.join(this.root, "store.json");
        if (!exists(identityPath)) {
            writeAtomic(identityPath, { schemaVersion: 1, id: randomUUID() });
        }
        const identity = readJson(identityPath);
        if (
            identity.schemaVersion !== 1 ||
            typeof identity.id !== "string" ||
            !ID.test(identity.id)
        )
            throw new Error("版本仓库身份无效");
        this.storeId = identity.id;
    }

    allocate(operationId: string, planDigest: string): GenerationCandidate {
        if (!safeOperation(operationId) || !DIGEST.test(planDigest))
            throw new Error("候选版本计划无效");
        const id = randomUUID();
        const directory = path.join(this.root, id);
        fs.mkdirSync(directory, { mode: 0o700 });
        const record: CandidateRecord = {
            schemaVersion: 1,
            phase: "candidate",
            id,
            storeId: this.storeId,
            operationId,
            planDigest,
        };
        writeAtomic(path.join(directory, CANDIDATE), record);
        return { id, directory, operationId, planDigest };
    }

    /** 仅隔离验证成功后的可信调用者可提交；下载完成不是验证证据。 */
    commitVerified(id: string, evidence: GenerationVerification): VerifiedGeneration {
        const candidate = this.candidate(id);
        const receiptPath = path.join(candidate.directory, RECEIPT);
        if (exists(receiptPath)) throw new Error("版本已有验证收据，禁止改写");
        if (this.isActive(id)) throw new Error("活动版本不能补写验证收据");
        validateVerification(evidence);
        if (evidence.planDigest !== candidate.planDigest)
            throw new Error("验证计划与候选版本不匹配");
        const manifests = verifyRuntime(candidate.directory, evidence);
        const receipt: GenerationReceipt = {
            planDigest: evidence.planDigest,
            hostVersion: evidence.hostVersion,
            coreVersion: evidence.coreVersion,
            nodeAbi: evidence.nodeAbi,
            platform: evidence.platform,
            arch: evidence.arch,
            checks: {
                packageIdentity: true,
                peerDependencies: true,
                singleHost: true,
                loadRegistration: true,
                schemas: true,
            },
            ...manifests,
            schemaVersion: 1,
            phase: "verified",
            id,
            storeId: this.storeId,
            operationId: candidate.operationId,
            verifiedAt: new Date().toISOString(),
            lockDigest: fileDigest(path.join(candidate.directory, LOCK)),
            schemasDigest: schemaDigest(path.join(candidate.directory, SCHEMAS)),
        };
        writeAtomic(receiptPath, receipt);
        return this.readVerified(id);
    }

    readVerified(id: string): VerifiedGeneration {
        const candidate = readVerifiedGeneration(this.root, id);
        if (candidate.receipt.storeId !== this.storeId) throw new Error("版本仓库身份已变化");
        return candidate;
    }

    /** 仅清理本仓库拥有的未验证候选；已验证版本的保留/回收另由控制服务管理。 */
    discard(id: string): void {
        const candidate = this.candidate(id);
        if (this.isActive(id)) throw new Error("不能删除活动版本");
        if (exists(path.join(candidate.directory, RECEIPT)))
            throw new Error("不能丢弃已有收据的运行版本");
        fs.rmSync(candidate.directory, { recursive: true });
    }

    private candidate(id: string): GenerationCandidate {
        return readCandidateRecord(this.root, this.storeId, id);
    }
}

function safeOperation(value: unknown): value is string {
    return typeof value === "string" && /^[a-zA-Z0-9._-]{1,128}$/.test(value);
}

function validateVerification(value: unknown): asserts value is GenerationVerification {
    const checks = record(value) ? value.checks : undefined;
    if (
        !record(value) ||
        typeof value.planDigest !== "string" ||
        !DIGEST.test(value.planDigest) ||
        typeof value.hostVersion !== "string" ||
        !VERSION.test(value.hostVersion) ||
        typeof value.coreVersion !== "string" ||
        !VERSION.test(value.coreVersion) ||
        value.nodeAbi !== process.versions.modules ||
        value.platform !== process.platform ||
        value.arch !== process.arch ||
        !record(checks) ||
        CHECKS.some(check => checks[check] !== true)
    )
        throw new Error("版本验证证据不完整或与当前运行环境不兼容");
}

function verifyRuntime(
    directory: string,
    evidence: GenerationVerification,
): { hostManifestDigest: string; coreManifestDigest: string } {
    const digests: string[] = [];
    for (const [name, version] of [
        ["onebots", evidence.hostVersion],
        ["@onebots/core", evidence.coreVersion],
    ]) {
        const manifestPath = path.join(directory, "node_modules", name, "package.json");
        const real = fs.realpathSync(manifestPath);
        if (!real.startsWith(`${directory}${path.sep}`))
            throw new Error("宿主依赖解析到候选版本之外");
        const manifest = readJson(real);
        if (manifest.name !== name || manifest.version !== version)
            throw new Error("宿主或核心版本身份不匹配");
        digests.push(fileDigest(real));
    }
    return { hostManifestDigest: digests[0], coreManifestDigest: digests[1] };
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exists(file: string): boolean {
    try {
        fs.lstatSync(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

function readJson(file: string): Record<string, unknown> {
    regularFile(file, 1024 * 1024);
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!record(value)) throw new Error("版本元数据必须是 JSON 对象");
    return value;
}

function regularFile(file: string, maxSize: number): void {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxSize)
        throw new Error("版本产物不是合法常规文件");
}

function fileDigest(file: string): string {
    regularFile(file, 32 * 1024 * 1024);
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function schemaDigest(file: string): string {
    readJson(file);
    return fileDigest(file);
}

function writeAtomic(file: string, value: unknown): void {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, JSON.stringify(value) + "\n");
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(temporary, file);
        if (process.platform !== "win32") {
            const directory = fs.openSync(path.dirname(file), "r");
            try {
                fs.fsyncSync(directory);
            } finally {
                fs.closeSync(directory);
            }
        }
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

/** 只读打开已有仓库；不创建目录、修复权限或生成仓库身份。 */
function readStoreIdentity(input: string): { root: string; id: string } {
    if (!path.isAbsolute(input)) throw new Error("版本仓库路径无效");
    const root = path.resolve(input);
    const stat = fs.lstatSync(root);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        fs.realpathSync(root) !== root ||
        (process.platform !== "win32" && (stat.mode & 0o077) !== 0) ||
        (process.platform !== "win32" && process.getuid && stat.uid !== process.getuid())
    )
        throw new Error("版本仓库归属无效");
    const identity = readJson(path.join(root, "store.json"));
    if (identity.schemaVersion !== 1 || typeof identity.id !== "string" || !ID.test(identity.id))
        throw new Error("版本仓库身份无效");
    return { root, id: identity.id };
}
/** 完整复核既有收据，无目录、权限或日志写入。工件仍依赖可信用户独占。 */
export function readVerifiedGeneration(root: string, id: string): VerifiedGeneration {
    const store = readStoreIdentity(root);
    const candidate = readCandidateRecord(store.root, store.id, id);
    const value = readJson(path.join(candidate.directory, RECEIPT));
    validateVerification(value);
    if (
        value.schemaVersion !== 1 ||
        value.phase !== "verified" ||
        value.id !== id ||
        value.storeId !== store.id ||
        value.operationId !== candidate.operationId ||
        value.planDigest !== candidate.planDigest ||
        typeof value.verifiedAt !== "string" ||
        !Number.isFinite(Date.parse(value.verifiedAt)) ||
        typeof value.lockDigest !== "string" ||
        !DIGEST.test(value.lockDigest) ||
        typeof value.schemasDigest !== "string" ||
        !DIGEST.test(value.schemasDigest)
    )
        throw new Error("运行版本验证收据无效");
    const manifests = verifyRuntime(candidate.directory, value);
    if (
        value.hostManifestDigest !== manifests.hostManifestDigest ||
        value.coreManifestDigest !== manifests.coreManifestDigest ||
        value.lockDigest !== fileDigest(path.join(candidate.directory, LOCK)) ||
        value.schemasDigest !== schemaDigest(path.join(candidate.directory, SCHEMAS))
    )
        throw new Error("运行版本锁文件或 Schema 已变化，必须重新生成候选版本");
    return { ...candidate, receipt: value as unknown as GenerationReceipt };
}

function readCandidateRecord(root: string, storeId: string, id: string): GenerationCandidate {
    if (!ID.test(id)) throw new Error("运行版本标识无效");
    const directory = path.join(root, id);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory)
        throw new Error("运行版本目录归属无效");
    const value = readJson(path.join(directory, CANDIDATE));
    if (
        value.schemaVersion !== 1 ||
        value.phase !== "candidate" ||
        value.id !== id ||
        value.storeId !== storeId ||
        !safeOperation(value.operationId) ||
        typeof value.planDigest !== "string" ||
        !DIGEST.test(value.planDigest)
    )
        throw new Error("候选版本所有权记录无效");
    return { id, directory, operationId: value.operationId, planDigest: value.planDigest };
}
