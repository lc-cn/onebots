import {
    loadConfigurationPanelSource,
    createConfirmedConfigurationRepair,
    type ConfigurationSource,
} from "./control-configuration-source.js";

import { computed, onMounted, onUnmounted, ref } from "vue";
import type {
    ControlClient,
    ControlConfigurationSnapshot,
    ControlConfigurationDraft,
    ControlConfigurationValidation,
    ControlConfigurationOperation,
} from "@onebots/core/control";
import {
    resolveConfigurationConflict,
    configurationRequest as bounded,
    matchingConfigurationTracking,
    readConfigurationTracking,
    type ConfigurationTracking as Tracking,
} from "./control-configuration-recovery.js";
import type { SchemaFieldDef } from "./config/types.js";
import {
    configurationGroups,
    configurationEdits,
    configurationSecret,
    schemaRecord,
    valueAt,
} from "./control-configuration-form.js";
export function useControlConfigurationPanel(client: ControlClient, onApplied: () => void) {
    const source = ref<ConfigurationSource>();
    const schemas = ref<Record<string, unknown>>({});
    const sourceUnavailable = ref(false);
    const STORAGE = "onebots.control.configuration";
    const snapshot = ref<ControlConfigurationSnapshot>();
    const draft = ref<ControlConfigurationDraft>();
    const validation = ref<ControlConfigurationValidation>();
    const operation = ref<ControlConfigurationOperation>();
    const tracking = ref<Tracking>({});
    const values = ref<Record<string, unknown>>({});
    const modes = ref<Record<string, "keep" | "set" | "clear">>({});
    const changed = ref(new Set<string>());
    const busy = ref(false);
    const staleBase = ref(false);
    const message = ref("");
    const error = ref("");
    const platform = ref("");
    const accountId = ref("");
    const accountTarget = ref("");
    const protocol = ref("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const projection = computed(() => draft.value ?? snapshot.value);
    const adapters = computed(() => Object.keys(schemaRecord(schemas.value.adapters)));
    const protocols = computed(() => Object.keys(schemaRecord(schemas.value.protocols)));
    const accounts = computed(() =>
        Object.keys(projection.value?.document ?? {}).filter(key =>
            adapters.value.includes(key.slice(0, key.indexOf("."))),
        ),
    );
    const groups = computed(() =>
        projection.value ? configurationGroups(schemas.value, projection.value) : [],
    );
    const fields = computed(() => groups.value.flatMap(group => group.fields));
    const dirty = computed(() => changed.value.size > 0);
    const locked = computed(
        () =>
            busy.value ||
            sourceUnavailable.value ||
            !draft.value ||
            Boolean(tracking.value.operationId),
    );
    const repairBlocked = computed(
        () =>
            busy.value ||
            Boolean(
                tracking.value.operationId &&
                (!operation.value ||
                    operation.value.status === "running" ||
                    operation.value.recoveryRequired),
            ),
    );
    const secret = (field: SchemaFieldDef) =>
        configurationSecret(field, projection.value?.secretStates ?? []);
    function remember(next: Tracking) {
        localStorage.setItem(STORAGE, JSON.stringify(next));
        tracking.value = next;
    }
    function adopt(value: ControlConfigurationDraft) {
        draft.value = value;
        validation.value = undefined;
        changed.value = new Set();
        modes.value = {};
        values.value = Object.fromEntries(
            configurationGroups(schemas.value, value).flatMap(group =>
                group.fields.map(field => [field.key, valueAt(value.document, field.path)]),
            ),
        );
    }
    function change(field: SchemaFieldDef, value: unknown) {
        values.value[field.key] = value;
        changed.value.add(field.key);
        validation.value = undefined;
    }
    function mode(field: SchemaFieldDef, value: string) {
        if (value !== "keep" && value !== "set" && value !== "clear") return;
        modes.value[field.key] = value;
        values.value[field.key] = undefined;
        if (value === "keep") changed.value.delete(field.key);
        else changed.value.add(field.key);
        validation.value = undefined;
    }
    async function reloadSource(resume: boolean) {
        busy.value = true;
        error.value = "";
        try {
            const result = await loadConfigurationPanelSource(
                client,
                resume ? tracking.value.draftId : undefined,
            );
            source.value = result.source;
            sourceUnavailable.value = Boolean(result.source || result.draftUnavailable);
            snapshot.value = result.snapshot;
            schemas.value = result.context?.schemas ?? result.snapshot?.schemas ?? {};
            if (result.context) adopt(result.context.draft);
            else if (!tracking.value.operationId) draft.value = undefined;
            message.value = result.source
                ? "检测到配置语法损坏；只有明确确认后才会创建修复草稿。"
                : result.draftUnavailable
                  ? "原草稿暂不可读取；保留原操作标识，可查看当前配置。"
                  : "已重新读取。此前未保存到草稿的本地修改已放弃。";
        } catch {
            source.value = undefined;
            snapshot.value = undefined;
            sourceUnavailable.value = true;
            error.value = "配置暂不可读取。请检查工作区；已存在的草稿不会被自动覆盖。";
        } finally {
            busy.value = false;
        }
    }
    async function reload() {
        await reloadSource(true);
    }
    async function createFresh() {
        await reloadSource(false);
        if (snapshot.value) await create();
    }
    async function repair(confirmed: boolean) {
        if (repairBlocked.value) return;
        busy.value = true;
        error.value = "";
        try {
            const context = await createConfirmedConfigurationRepair(
                client,
                source.value,
                confirmed,
            );
            remember({ draftId: context.draft.id });
            schemas.value = context.schemas;
            snapshot.value = undefined;
            source.value = undefined;
            sourceUnavailable.value = false;
            adopt(context.draft);
            operation.value = undefined;
            staleBase.value = false;
            message.value = "原文件已私有备份。请编辑修复草稿，再校验和应用；尚未修改运行配置。";
        } catch {
            error.value = "修复草稿创建未确认或版本已变化，请重新读取；不会自动重新提交。";
        } finally {
            busy.value = false;
        }
    }
    async function create() {
        if (!snapshot.value) return;
        busy.value = true;
        error.value = "";
        try {
            const result = await bounded(client.createConfigurationDraft(snapshot.value.base));
            remember({ draftId: result.id });
            adopt(result);
            operation.value = undefined;
            staleBase.value = false;
            sourceUnavailable.value = false;
            message.value = "草稿已创建。保存草稿不会影响正在运行的账号。";
        } catch {
            error.value = "创建草稿失败或版本已变化，请重新读取配置。";
        } finally {
            busy.value = false;
        }
    }
    async function save(): Promise<boolean> {
        if (!draft.value) return false;
        let edits: ReturnType<typeof configurationEdits>;
        try {
            edits = configurationEdits(
                fields.value,
                draft.value.secretStates,
                values.value,
                modes.value,
                changed.value,
            );
        } catch (caught) {
            error.value = caught instanceof Error ? caught.message : "字段格式无效";
            return false;
        }
        busy.value = true;
        error.value = "";
        const request = { expectedRevision: draft.value.revision, ...edits };
        // 请求副本仅保留到本次传输；输入控件立即清除秘密，不写入浏览器存储。
        for (const field of fields.value) if (secret(field)) values.value[field.key] = undefined;
        try {
            adopt(await bounded(client.editConfigurationDraft(draft.value.id, request)));
            message.value = "草稿已保存，尚未应用。";
            return true;
        } catch {
            error.value = "保存未确认或版本冲突。请重读草稿核对；不会自动覆盖或重复提交。";
            return false;
        } finally {
            busy.value = false;
        }
    }
    async function addAccount() {
        if (!draft.value || !platform.value || !accountId.value || dirty.value) return;
        busy.value = true;
        error.value = "";
        try {
            adopt(
                await bounded(
                    client.addConfigurationAccount(draft.value.id, {
                        expectedRevision: draft.value.revision,
                        platform: platform.value,
                        accountId: accountId.value,
                    }),
                ),
            );
            accountId.value = "";
        } catch {
            error.value = "账号添加未确认，请重读草稿核对账号标识和版本。";
        } finally {
            busy.value = false;
        }
    }
    async function removeAccount(key: string) {
        if (!draft.value || dirty.value) return;
        busy.value = true;
        error.value = "";
        try {
            adopt(
                await bounded(
                    client.removeConfigurationAccount(draft.value.id, {
                        expectedRevision: draft.value.revision,
                        accountKey: key,
                    }),
                ),
            );
        } catch {
            error.value = "删除未确认，请重读草稿核对。";
        } finally {
            busy.value = false;
        }
    }
    async function setProtocol(enabled: boolean) {
        if (!draft.value || !protocol.value || dirty.value) return;
        busy.value = true;
        error.value = "";
        try {
            adopt(
                await bounded(
                    client.setConfigurationProtocol(draft.value.id, {
                        expectedRevision: draft.value.revision,
                        accountKey: accountTarget.value || null,
                        protocol: protocol.value,
                        enabled,
                    }),
                ),
            );
        } catch {
            error.value = "协议修改未确认，请重读草稿核对。";
        } finally {
            busy.value = false;
        }
    }
    async function editList(path: string[], action: "append" | "remove", index?: number) {
        if (!draft.value || dirty.value || locked.value) return;
        busy.value = true;
        error.value = "";
        try {
            adopt(
                await bounded(
                    client.editConfigurationList(draft.value.id, {
                        expectedRevision: draft.value.revision,
                        path,
                        action,
                        ...(index !== undefined ? { index } : {}),
                    }),
                ),
            );
        } catch {
            error.value = "列表修改未确认或版本已变化，请重读草稿核对。";
        } finally {
            busy.value = false;
        }
    }
    async function validate() {
        if (!draft.value || dirty.value) return;
        busy.value = true;
        error.value = "";
        try {
            validation.value = await bounded(
                client.validateConfigurationDraft(draft.value.id, draft.value.revision),
            );
        } catch {
            error.value = "校验未完成或版本已变化，请重读草稿后再校验。";
        } finally {
            busy.value = false;
        }
    }
    async function query() {
        if (!tracking.value.operationId || disposed) return;
        if (timer) clearTimeout(timer);
        try {
            const result = await bounded(client.configurationOperation(tracking.value.operationId));
            if (
                result.id !== tracking.value.operationId ||
                result.validationId !== tracking.value.receiptId
            )
                throw new Error("identity");
            operation.value = result;
            if (result.status === "running" && !disposed) timer = setTimeout(query, 2000);
            if (result.status === "succeeded") {
                message.value = "配置已应用。网关原本停止时仍保持停止。";
                onApplied();
            }
        } catch {
            error.value = "暂时无法确认应用结果。请查询原操作，不要重新创建应用请求。";
        }
    }
    async function apply() {
        if (!validation.value?.receiptId || !draft.value || tracking.value.operationId) return;
        const next = {
            draftId: draft.value.id,
            operationId: crypto.randomUUID(),
            receiptId: validation.value.receiptId,
        };
        try {
            remember(next);
        } catch {
            error.value = "无法保存操作标识，请允许浏览器本地存储后再应用。";
            return;
        }
        busy.value = true;
        error.value = "";
        try {
            operation.value = await bounded(
                client.applyConfiguration(next.operationId, next.receiptId),
            );
        } catch (caught) {
            const recovery = await resolveConfigurationConflict({
                error: caught,
                newlySubmitted: true,
                submitted: next,
                current: () =>
                    matchingConfigurationTracking(tracking.value, localStorage.getItem(STORAGE)),
                lookup: id => bounded(client.configurationOperation(id)),
            });
            if (recovery.existing) operation.value = recovery.existing;
            if (recovery.clear) {
                try {
                    remember({ draftId: draft.value?.id });
                    validation.value = undefined;
                    staleBase.value = true;
                } catch {
                    error.value = "本地操作记录无法更新，请保留原操作查询。";
                    return;
                }
                error.value =
                    "版本已变化，本次应用未执行。请重新读取配置并创建新草稿，不会自动提交。";
            } else error.value = "应用请求结果未确认，正在查询同一操作。";
        } finally {
            busy.value = false;
            await query();
        }
    }
    onMounted(async () => {
        try {
            tracking.value = readConfigurationTracking(localStorage.getItem(STORAGE));
        } catch {
            error.value = "浏览器恢复记录不可读取，不会自动提交操作。";
        }
        await reload();
        if (tracking.value.operationId) await query();
    });
    onUnmounted(() => {
        disposed = true;
        if (timer) clearTimeout(timer);
        values.value = {};
    });

    return {
        source,
        repair,
        repairBlocked,
        snapshot,
        draft,
        validation,
        operation,
        tracking,
        values,
        modes,
        busy,
        staleBase,
        message,
        error,
        platform,
        accountId,
        accountTarget,
        protocol,
        projection,
        adapters,
        protocols,
        accounts,
        groups,
        dirty,
        locked,
        reload,
        createFresh,
        create,
        save,
        addAccount,
        removeAccount,
        setProtocol,
        editList,
        validate,
        query,
        apply,
        change,
        mode,
    };
}
