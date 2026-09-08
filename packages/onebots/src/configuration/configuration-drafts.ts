import {
    ConfigurationConflictError,
    type ConfigurationBase,
    type ConfigurationDraft,
    type ConfigurationStore,
} from "./configuration-store.js";
import {
    applyConfigurationChanges,
    applySecretChanges,
    parseConfigurationDocument,
    projectConfiguration,
    type ConfigurationChange,
    type ConfigurationDocument,
    type SecretChange,
} from "./configuration-document.js";
import {
    inspectConfigurationPaths,
    type ConfigurationSchemaBundle,
} from "./configuration-schema.js";
import { prepareConfigurationContainers } from "./configuration-containers.js";
import { editConfigurationList, type ConfigurationListChange } from "./configuration-list.js";

export interface ConfigurationContext {
    base: ConfigurationBase;
    document: ConfigurationDocument;
    schemas: ConfigurationSchemaBundle;
}

/** 草稿应用服务只返回脱敏投影；实际应用由唯一生命周期队列另行执行。 */
export class ConfigurationDrafts {
    constructor(
        private readonly options: {
            store: ConfigurationStore;
            current(): ConfigurationContext;
        },
    ) {}

    snapshot() {
        const context = this.options.current();
        return {
            base: structuredClone(context.base),
            ...this.project(context.document, context.schemas),
        };
    }

    create(expected: ConfigurationBase) {
        const context = this.context(expected);
        return this.view(
            this.options.store.create(context.base, context.document),
            context.schemas,
        );
    }

    read(id: string) {
        const draft = this.options.store.read(id);
        return this.view(draft, this.context(draft.base).schemas);
    }

    edit(request: {
        id: string;
        expectedRevision: string;
        changes: ConfigurationChange[];
        secrets: SecretChange[];
    }) {
        const draft = this.options.store.read(request.id);
        const context = this.context(draft.base);
        if (draft.revision !== request.expectedRevision) throw new ConfigurationConflictError();
        const clean = parseConfigurationDocument({
            changes: request.changes,
            secrets: request.secrets,
        });
        if (!Array.isArray(clean.changes) || !Array.isArray(clean.secrets))
            throw new Error("配置修改请求无效");
        const pathsToSet = [...clean.changes, ...clean.secrets].flatMap(change =>
            change && typeof change === "object" && !Array.isArray(change) && change.op === "set"
                ? [change.path]
                : [],
        ) as string[][];
        const document = prepareConfigurationContainers(
            context.schemas,
            parseConfigurationDocument(draft.document),
            pathsToSet,
        );
        const original = inspectConfigurationPaths(context.schemas, document);
        // 先计算目标结构，再用目标和原始 Schema 路径重新授权，不能通过新建秘密字段绕过。
        const proposed = applyConfigurationChanges(document, clean.changes, []);
        const target = inspectConfigurationPaths(context.schemas, proposed);
        const paths = minimalPaths([...original.sensitivePaths, ...target.sensitivePaths]);
        const changed = applyConfigurationChanges(document, clean.changes, paths);
        const result = applySecretChanges(changed, clean.secrets, paths);
        const saved = this.options.store.replace(draft.id, request.expectedRevision, result);
        return this.view(saved, context.schemas);
    }

    editList(id: string, expectedRevision: string, change: ConfigurationListChange) {
        const draft = this.options.store.read(id);
        const context = this.context(draft.base);
        if (draft.revision !== expectedRevision) throw new ConfigurationConflictError();
        const document = editConfigurationList(
            context.schemas,
            parseConfigurationDocument(draft.document),
            change,
        );
        // 先验证目标投影，不允许写入后才发现草稿无法读取。
        this.project(document, context.schemas);
        return this.view(
            this.options.store.replace(id, expectedRevision, document),
            context.schemas,
        );
    }

    /** 用户显式添加账号，仅建立空结构，不填凭据或协议，不操作运行配置。 */
    addAccount(id: string, expectedRevision: string, platform: string, accountId: string) {
        const draft = this.options.store.read(id);
        const context = this.context(draft.base);
        if (draft.revision !== expectedRevision) throw new ConfigurationConflictError();
        if (
            typeof platform !== "string" ||
            !Object.hasOwn(context.schemas.adapters, platform) ||
            typeof accountId !== "string" ||
            !accountId.length ||
            accountId.length > 256 ||
            /[\u0000-\u001f]/.test(accountId)
        )
            throw new Error("账号标识无效");
        const document = parseConfigurationDocument(draft.document);
        const key = `${platform}.${accountId}`;
        if (Object.hasOwn(document, key)) throw new Error("账号已存在");
        document[key] = {};
        enable(document, "adapters", platform);
        return this.view(
            this.options.store.replace(id, expectedRevision, document),
            context.schemas,
        );
    }

    removeAccount(id: string, expectedRevision: string, accountKey: string) {
        const draft = this.options.store.read(id);
        const context = this.context(draft.base);
        if (draft.revision !== expectedRevision) throw new ConfigurationConflictError();
        const document = parseConfigurationDocument(draft.document);
        account(document, context.schemas, accountKey);
        delete document[accountKey];
        return this.view(
            this.options.store.replace(id, expectedRevision, document),
            context.schemas,
        );
    }

    setProtocol(
        id: string,
        request: {
            expectedRevision: string;
            accountKey: string | null;
            protocol: string;
            enabled: boolean;
        },
    ) {
        const draft = this.options.store.read(id);
        const context = this.context(draft.base);
        if (draft.revision !== request.expectedRevision) throw new ConfigurationConflictError();
        if (
            typeof request.protocol !== "string" ||
            !Object.hasOwn(context.schemas.protocols, request.protocol) ||
            typeof request.enabled !== "boolean"
        )
            throw new Error("协议配置选择无效");
        const document = parseConfigurationDocument(draft.document);
        let target: ConfigurationDocument;
        if (request.accountKey === null) {
            if (!Object.hasOwn(document, "general")) document.general = {};
            target = object(document.general);
        } else target = account(document, context.schemas, request.accountKey);
        if (request.enabled) {
            if (!Object.hasOwn(target, request.protocol)) target[request.protocol] = {};
            enable(document, "protocols", context.schemas.protocolRegistrations[request.protocol]);
        } else delete target[request.protocol];
        return this.view(
            this.options.store.replace(id, request.expectedRevision, document),
            context.schemas,
        );
    }

    private context(expected: ConfigurationBase): ConfigurationContext {
        const current = this.options.current();
        if (
            !expected ||
            expected.generationId !== current.base.generationId ||
            expected.configRevision !== current.base.configRevision
        )
            throw new ConfigurationConflictError();
        return current;
    }

    private view(draft: ConfigurationDraft, schemas: ConfigurationSchemaBundle) {
        return {
            id: draft.id,
            revision: draft.revision,
            base: structuredClone(draft.base),
            ...this.project(draft.document, schemas),
        };
    }

    private project(document: unknown, schemas: ConfigurationSchemaBundle) {
        const parsed = parseConfigurationDocument(document);
        const inspection = inspectConfigurationPaths(schemas, parsed);
        return {
            ...projectConfiguration(parsed, inspection.sensitivePaths),
            unknownPaths: inspection.unknownPaths,
        };
    }
}

function object(value: unknown): ConfigurationDocument {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("配置容器无效");
    return value as ConfigurationDocument;
}
function account(
    document: ConfigurationDocument,
    schemas: ConfigurationSchemaBundle,
    key: string,
): ConfigurationDocument {
    if (
        typeof key !== "string" ||
        key.indexOf(".") <= 0 ||
        !Object.hasOwn(document, key) ||
        !Object.hasOwn(schemas.adapters, key.slice(0, key.indexOf(".")))
    )
        throw new Error("账号不存在");
    return object(document[key]);
}
function enable(
    document: ConfigurationDocument,
    kind: "adapters" | "protocols",
    name: string,
): void {
    if (!name) throw new Error("扩展注册映射无效");
    if (!Object.hasOwn(document, "plugins"))
        document.plugins = { adapters: [], protocols: [], applications: [] };
    const plugins = object(document.plugins);
    const existing = plugins[kind] ?? [];
    if (!Array.isArray(existing) || existing.some(value => typeof value !== "string"))
        throw new Error("扩展选择无效");
    plugins[kind] = [...new Set([...existing, name])];
}

function minimalPaths(paths: string[][]): string[][] {
    return paths.filter(
        (path, index) =>
            !paths.some(
                (other, otherIndex) =>
                    otherIndex !== index &&
                    other.length <= path.length &&
                    other.every((key, position) => key === path[position]) &&
                    (other.length < path.length || otherIndex < index),
            ),
    );
}
