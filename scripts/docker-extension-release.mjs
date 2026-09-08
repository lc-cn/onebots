import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const RELEASE_STATE = "active-release.json";
export const RECEIPT = "onebots-release.json";
export function validReleaseId(id) {
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id))
        throw new Error("扩展版本标识无效");
    return id;
}
export function readJson(file) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
        throw new Error("扩展元数据不是合法文件");
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("扩展元数据格式无效");
    return value;
}
export function writeJson(file, value) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
            mode: 0o600,
            flag: "wx",
        });
        fs.renameSync(temporary, file);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}
export function imageFingerprint(imageRoot = "/app") {
    const metadata = fs.readFileSync(
        path.join(imageRoot, "packages/onebots/lib/extension-capability-catalog.json"),
    );
    const host = readJson(path.join(imageRoot, "packages/onebots/package.json"));
    return createHash("sha256")
        .update(metadata)
        .update(
            JSON.stringify([
                host.version,
                process.version,
                process.arch,
                process.platform,
                process.versions.modules,
            ]),
        )
        .digest("hex");
}
export function releasePath(root, id) {
    validReleaseId(id);
    const destination = path.join(root, "releases", id);
    if (fs.realpathSync(destination) !== path.resolve(destination))
        throw new Error("扩展版本目录不能包含符号链接");
    return destination;
}
export function readReleaseState(root) {
    const file = path.join(root, RELEASE_STATE);
    if (!fs.existsSync(file)) return { schemaVersion: 1, current: null, previous: null };
    const state = readJson(file);
    if (state.schemaVersion !== 1) throw new Error("扩展切换记录版本无效");
    for (const id of [state.current, state.previous]) if (id !== null) validReleaseId(id);
    return state;
}
export function verifyReceipt(root, id, fingerprint) {
    const directory = releasePath(root, id);
    const receipt = readJson(path.join(directory, RECEIPT));
    if (
        receipt.schemaVersion !== 1 ||
        receipt.phase !== "verified" ||
        receipt.id !== id ||
        receipt.fingerprint !== fingerprint
    )
        throw new Error("扩展版本未验证或与当前镜像不兼容，请用当前镜像重新安装；不会自动下载依赖");
    const digest = createHash("sha256")
        .update(fs.readFileSync(path.join(directory, "pnpm-lock.yaml")))
        .digest("hex");
    if (receipt.lockDigest !== digest) throw new Error("扩展锁文件已改变，请重新验证");
    return directory;
}
export function resolveDockerRelease(root, fingerprint = imageFingerprint()) {
    const state = readReleaseState(root);
    return state.current === null ? root : verifyReceipt(root, state.current, fingerprint);
}
export function switchDockerRelease(root, id, fingerprint = imageFingerprint()) {
    const previous = readReleaseState(root);
    verifyReceipt(root, id, fingerprint);
    if (previous.current === id) return previous;
    const next = { schemaVersion: 1, current: id, previous: previous.current };
    writeJson(path.join(root, RELEASE_STATE), next);
    return next;
}
export function rollbackDockerRelease(root, expected, fingerprint = imageFingerprint()) {
    const state = readReleaseState(root);
    if (state.current !== expected) throw new Error("扩展版本已被其他操作切换，拒绝覆盖");
    if (state.previous) verifyReceipt(root, state.previous, fingerprint);
    const next = { schemaVersion: 1, current: state.previous, previous: state.current };
    writeJson(path.join(root, RELEASE_STATE), next);
    return next;
}
function ownTree(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory() && !item.isSymbolicLink()) ownTree(file);
        fs.lchownSync(file, 1000, 1000);
    }
    fs.chownSync(directory, 1000, 1000);
}
export function manageRelease(command, root, id, expected = id) {
    validReleaseId(id);
    const lock = path.join(root, ".release-install.lock");
    if (command === "init") {
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        fs.mkdirSync(lock, { mode: 0o700 });
        try {
            writeJson(path.join(lock, "owner.json"), { id });
            fs.mkdirSync(path.join(root, "releases"), { recursive: true, mode: 0o700 });
            fs.mkdirSync(path.join(root, "releases", id), { mode: 0o700 });
            if (process.getuid?.() === 0) {
                fs.chownSync(root, 1000, 1000);
                fs.chownSync(path.join(root, "releases"), 1000, 1000);
                fs.chownSync(path.join(root, "releases", id), 1000, 1000);
            }
        } catch (error) {
            fs.rmSync(lock, { recursive: true, force: true });
            throw error;
        }
        return;
    }
    if (readJson(path.join(lock, "owner.json")).id !== id) throw new Error("安装锁不属于当前操作");
    if (command === "current") {
        process.stdout.write((readReleaseState(root).current ?? "legacy") + "\n");
        return;
    }
    if (command === "plan") {
        const state = readReleaseState(root);
        let packages = {};
        if (state.current)
            packages = readJson(path.join(releasePath(root, state.current), RECEIPT)).packages;
        else if (fs.existsSync(path.join(root, "package.json"))) {
            const manifest = readJson(path.join(root, "package.json"));
            const managed = manifest.onebotsDockerManagedDependencies ?? [];
            packages = Object.fromEntries(
                Object.entries(manifest.dependencies ?? {}).filter(
                    ([name]) =>
                        !managed.includes(name) && /^@onebots\/(?:adapter|protocol)-/.test(name),
                ),
            );
        }
        process.stdout.write(JSON.stringify(packages) + "\n");
        return;
    }
    if (command === "unlock") {
        fs.rmSync(lock, { recursive: true });
        return;
    }
    if (command === "activate") {
        const directory = verifyReceipt(root, id, imageFingerprint());
        if (process.getuid?.() === 0) ownTree(directory);
        switchDockerRelease(root, id);
    } else if (command === "rollback") rollbackDockerRelease(root, expected);
    else throw new Error("未知扩展版本操作");
    if (process.getuid?.() === 0) fs.chownSync(path.join(root, RELEASE_STATE), 1000, 1000);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [command, root = "/data/extensions", id, expected] = process.argv.slice(2);
        if (command === "assert-running") {
            if ((readReleaseState(root).current ?? "legacy") !== id)
                throw new Error("容器未采用本次选定的扩展版本");
            if (fs.realpathSync("/proc/1/cwd") !== resolveDockerRelease(root))
                throw new Error("容器未运行当前选定的扩展版本");
        } else if (command === "resolve") process.stdout.write(resolveDockerRelease(root) + "\n");
        else manageRelease(command, root, id, expected);
    } catch (error) {
        console.error(`[onebots] ${error instanceof Error ? error.message : "扩展版本操作失败"}`);
        process.exitCode = 1;
    }
}
