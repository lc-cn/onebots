import { createHash } from "node:crypto";
import { isAbsolute, normalize } from "node:path";
import semver from "semver";

export interface GenerationArtifact {
    name: string;
    version: string;
    spec: string;
    sha256?: string;
}

export interface GenerationExtension {
    type: "adapter" | "protocol" | "application";
    name: string;
    packageName: string;
    version: string;
    spec: string;
    sha256?: string;
    peerDependencies: Record<string, string>;
}

export interface GenerationSelection {
    adapters: string[];
    protocols: string[];
    applications: string[];
}

export interface GenerationTarget {
    platform: NodeJS.Platform;
    arch: string;
    nodeAbi: string;
}

export interface GenerationPlanInput {
    host: GenerationArtifact;
    core: GenerationArtifact;
    extensions: GenerationExtension[];
    selection: GenerationSelection;
    target?: GenerationTarget;
    builtinApplications?: readonly string[];
}

export interface GenerationPeerRequirement {
    requestedBy: string;
    packageName: string;
    range: string;
}

export interface GenerationManifest {
    packageManager: "pnpm@9.15.9";
    name: string;
    version: string;
    private: true;
    type: "module";
    dependencies: Record<string, string>;
    pnpm: { overrides: Record<string, string> };
}

export interface GenerationPlan extends GenerationTarget {
    schemaVersion: 1;
    host: GenerationArtifact;
    core: GenerationArtifact;
    extensions: GenerationExtension[];
    selection: GenerationSelection;
    dependencies: Record<string, string>;
    peerRequirements: GenerationPeerRequirement[];
    builtinApplications: string[];
    manifest: GenerationManifest;
    digest: string;
}

/** Pure declaration planning only: a digest is not download, peer resolution, or validation evidence. */
export function createGenerationPlan(input: GenerationPlanInput): GenerationPlan {
    const host = artifact(input.host);
    const core = artifact(input.core);
    if (host.name !== "onebots" || core.name !== "@onebots/core")
        throw new Error("运行版本必须明确包含 onebots 和 @onebots/core 工件");
    const selection: GenerationSelection = {
        adapters: names(input.selection.adapters),
        protocols: names(input.selection.protocols),
        applications: names(input.selection.applications),
    };
    const builtinApplications = names(input.builtinApplications ?? []).filter(name =>
        selection.applications.includes(name),
    );
    const expected = new Set([
        ...selection.adapters.map(name => `adapter:${name}`),
        ...selection.protocols.map(name => `protocol:${name}`),
        ...selection.applications
            .filter(name => !builtinApplications.includes(name))
            .map(name => `application:${name}`),
    ]);
    const packages = new Map<string, GenerationArtifact>([
        [host.name, host],
        [core.name, core],
    ]);
    const extensions: GenerationExtension[] = [];
    const peerRequirements: GenerationPeerRequirement[] = [];
    for (const extension of input.extensions) {
        const key = `${extension.type}:${extension.name}`;
        if (!expected.delete(key)) throw new Error("扩展工件与选择不一致或重复");
        const source = artifact({
            name: extension.packageName,
            version: extension.version,
            spec: extension.spec,
            sha256: extension.sha256,
        });
        if (packages.has(source.name)) throw new Error("运行版本内存在重复包身份");
        packages.set(source.name, source);
        const peerDependencies: Record<string, string> = {};
        for (const packageName of Object.keys(extension.peerDependencies).sort()) {
            validatePackageName(packageName);
            const range = extension.peerDependencies[packageName];
            if (typeof range !== "string" || !range.trim() || !semver.validRange(range))
                throw new Error("扩展 peer 必须使用有效的 semver 范围");
            peerDependencies[packageName] = range;
            peerRequirements.push({ requestedBy: source.name, packageName, range });
        }
        extensions.push({
            type: extension.type,
            name: extension.name,
            packageName: source.name,
            version: source.version,
            spec: source.spec,
            ...(source.sha256 ? { sha256: source.sha256 } : {}),
            peerDependencies,
        });
    }
    if (expected.size) throw new Error("所选扩展缺少精确版本工件");
    extensions.sort((left, right) =>
        compare(`${left.type}:${left.name}`, `${right.type}:${right.name}`),
    );
    peerRequirements.sort((left, right) =>
        compare(
            `${left.packageName}:${left.requestedBy}`,
            `${right.packageName}:${right.requestedBy}`,
        ),
    );

    const dependencies: Record<string, string> = Object.fromEntries(
        [...packages].map(([name, item]) => [name, item.spec]),
    );
    const peerRanges = new Map<string, string[]>();
    for (const requirement of peerRequirements) {
        const fixed = packages.get(requirement.packageName);
        if (fixed && !semver.satisfies(fixed.version, requirement.range))
            throw new Error(`工件 ${fixed.name} 的版本不满足扩展原始 peer 约束`);
        if (!fixed)
            peerRanges.set(requirement.packageName, [
                ...(peerRanges.get(requirement.packageName) ?? []),
                requirement.range,
            ]);
    }
    for (const [name, ranges] of peerRanges) dependencies[name] = intersectRanges(ranges);
    const sortedDependencies = sortedRecord(dependencies);
    const target = input.target ?? {
        platform: process.platform,
        arch: process.arch,
        nodeAbi: process.versions.modules,
    };
    if (
        ![
            "aix",
            "android",
            "darwin",
            "freebsd",
            "haiku",
            "linux",
            "openbsd",
            "sunos",
            "win32",
            "cygwin",
            "netbsd",
        ].includes(target.platform) ||
        !/^[a-z0-9_]+$/.test(target.arch) ||
        !/^\d+$/.test(target.nodeAbi)
    )
        throw new Error("目标平台、架构或 Node ABI 无效");
    const manifest: GenerationManifest = {
        packageManager: "pnpm@9.15.9",
        name: "onebots-gateway-generation",
        version: "0.0.0",
        private: true,
        type: "module",
        dependencies: { ...sortedDependencies },
        pnpm: { overrides: sortedRecord({ onebots: host.spec, "@onebots/core": core.spec }) },
    };
    const plan = {
        schemaVersion: 1 as const,
        host,
        core,
        extensions,
        selection,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: target.nodeAbi,
        dependencies: sortedDependencies,
        peerRequirements,
        builtinApplications,
        manifest,
    };
    return { ...plan, digest: createHash("sha256").update(JSON.stringify(plan)).digest("hex") };
}

function artifact(input: GenerationArtifact): GenerationArtifact {
    validatePackageName(input.name);
    if (
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(input.version) ||
        !semver.valid(input.version)
    )
        throw new Error("工件版本必须是精确 semver");
    if (typeof input.spec !== "string") throw new Error("工件来源无效");
    if (input.spec.startsWith("file:")) {
        const file = input.spec.slice(5);
        if (
            !isAbsolute(file) ||
            !file.endsWith(".tgz") ||
            /[\r\n\0?#]/.test(file) ||
            typeof input.sha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(input.sha256)
        )
            throw new Error("本地工件必须是绝对 .tgz 路径并提供 sha256");
        return {
            name: input.name,
            version: input.version,
            spec: `file:${normalize(file)}`,
            sha256: input.sha256,
        };
    }
    if (input.spec !== input.version || !semver.valid(input.spec))
        throw new Error("registry 工件必须使用精确版本，不能使用标签、范围或其他来源");
    return { name: input.name, version: input.version, spec: input.spec };
}

function validatePackageName(name: string): void {
    if (
        typeof name !== "string" ||
        name.length > 214 ||
        !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
    )
        throw new Error("依赖包名称无效");
}

function names(values: readonly string[]): string[] {
    if (
        !Array.isArray(values) ||
        values.some(name => typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(name))
    )
        throw new Error("扩展选择名称无效");
    return [...new Set(values)].sort();
}

/** Distribute OR clauses before conjunction; never flatten `a || b` into an incorrect range. */
function intersectRanges(ranges: string[]): string {
    const ordered = [...new Set(ranges)].sort();
    let combinations: string[][][] = [[]];
    for (const range of ordered) {
        const alternatives: string[][] = new semver.Range(range).set.map(comparators =>
            comparators.map(comparator => comparator.value),
        );
        if (combinations.length * alternatives.length > 256) throw new Error("peer 范围过于复杂");
        combinations = combinations.flatMap(combination =>
            alternatives.map(alternative => [...combination, alternative]),
        );
    }
    const clauses = combinations.flatMap(combination => {
        // A prerelease tuple must be explicitly admitted by every original AND group.
        const admitted = combination.map(
            part =>
                new Set(
                    part.flatMap(value => {
                        const version = new semver.Comparator(value).semver;
                        return version.prerelease?.length
                            ? [`${version.major}.${version.minor}.${version.patch}`]
                            : [];
                    }),
                ),
        );
        const normalized: string[] = [];
        for (const value of combination.flat()) {
            const comparator = new semver.Comparator(value);
            const version = comparator.semver;
            const base = `${version.major}.${version.minor}.${version.patch}`;
            if (!version.prerelease?.length || admitted.every(tuples => tuples.has(base))) {
                normalized.push(value);
            } else if (comparator.operator.startsWith(">")) {
                normalized.push(`>=${base}`);
            } else if (comparator.operator.startsWith("<")) {
                normalized.push(`<${base}-0`);
            } else {
                return []; // An exact prerelease excluded by another original range.
            }
        }
        return [normalized.join(" ").trim()];
    });
    const viable = clauses.filter(clause => {
        const minimum = semver.minVersion(clause);
        if (!minimum) return false;
        const candidates = [minimum.version, `${minimum.major}.${minimum.minor}.${minimum.patch}`];
        return candidates.some(
            version =>
                semver.satisfies(version, clause) &&
                ordered.every(range => semver.satisfies(version, range)),
        );
    });
    if (!viable.length) throw new Error("多个扩展的必需 peer 版本约束冲突");
    return [...new Set(viable)].sort().join(" || ") || "*";
}

function sortedRecord(value: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map(key => [key, value[key]]),
    );
}

function compare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
