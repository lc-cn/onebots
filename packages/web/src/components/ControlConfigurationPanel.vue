<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type {
    ControlClient,
    ControlConfigurationSnapshot,
    ControlConfigurationDraft,
    ControlConfigurationValidation,
    ControlConfigurationOperation,
    ControlConfigurationChange,
    ControlSecretChange,
} from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";
import {
    resolveConfigurationConflict,
    configurationRequest as bounded,
    matchingConfigurationTracking,
    readConfigurationTracking,
} from "./control-configuration-recovery.js";
import ControlConfigurationFields from "./ControlConfigurationFields.vue";
import type { SchemaFieldDef } from "./config/types.js";
import { parseStructuredFieldValue } from "./config/utils.js";
import {
    configurationGroups,
    fieldKey,
    schemaRecord,
    valueAt,
} from "./control-configuration-form.js";
const props = defineProps<{ client: ControlClient }>();
const emit = defineEmits<{ applied: [] }>();
const STORAGE = "onebots.control.configuration";
interface Tracking {
    draftId?: string;
    operationId?: string;
    receiptId?: string;
}
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
const adapters = computed(() => Object.keys(schemaRecord(snapshot.value?.schemas.adapters)));
const protocols = computed(() => Object.keys(schemaRecord(snapshot.value?.schemas.protocols)));
const accounts = computed(() =>
    Object.keys(projection.value?.document ?? {}).filter(key =>
        adapters.value.includes(key.slice(0, key.indexOf("."))),
    ),
);
const groups = computed(() =>
    snapshot.value && projection.value
        ? configurationGroups(snapshot.value.schemas, projection.value)
        : [],
);
const fields = computed(() => groups.value.flatMap(group => group.fields));
const dirty = computed(() => changed.value.size > 0);
const locked = computed(() => busy.value || !draft.value || Boolean(tracking.value.operationId));
const secret = (field: SchemaFieldDef) =>
    projection.value?.secretStates.find(state => fieldKey(state.path) === field.key);
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
        configurationGroups(snapshot.value?.schemas ?? {}, value).flatMap(group =>
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
async function reload() {
    busy.value = true;
    error.value = "";
    try {
        snapshot.value = await bounded(props.client.configurationSnapshot());
        if (tracking.value.draftId)
            adopt(await bounded(props.client.configurationDraft(tracking.value.draftId)));
        message.value = "已重新读取。此前未保存到草稿的本地修改已放弃。";
    } catch {
        error.value = "配置暂不可读取。请检查工作区；已存在的草稿不会被自动覆盖。";
    } finally {
        busy.value = false;
    }
}
async function create() {
    if (!snapshot.value) return;
    busy.value = true;
    error.value = "";
    try {
        const result = await bounded(props.client.createConfigurationDraft(snapshot.value.base));
        remember({ draftId: result.id });
        adopt(result);
        operation.value = undefined;
        staleBase.value = false;
        message.value = "草稿已创建。保存草稿不会影响正在运行的账号。";
    } catch {
        error.value = "创建草稿失败或版本已变化，请重新读取配置。";
    } finally {
        busy.value = false;
    }
}
async function save(): Promise<boolean> {
    if (!draft.value) return false;
    const changes: ControlConfigurationChange[] = [];
    const secrets: ControlSecretChange[] = [];
    for (const field of fields.value.filter(field => changed.value.has(field.key))) {
        let value = values.value[field.key];
        if (secret(field)) {
            const action = modes.value[field.key] ?? "keep";
            if (action === "set") {
                if (value === undefined) {
                    error.value = `请填写 ${field.label} 的新值`;
                    return false;
                }
                secrets.push({ op: "set", path: field.path, value });
            } else secrets.push({ op: action, path: field.path });
        } else {
            if (field.rule.type === "array" || field.rule.type === "object") {
                const parsed = parseStructuredFieldValue(value, field.rule, field.label);
                if (!parsed.ok) {
                    error.value = parsed.message;
                    return false;
                }
                value = parsed.value;
            }
            changes.push(
                value === undefined
                    ? { op: "remove", path: field.path }
                    : { op: "set", path: field.path, value },
            );
        }
    }
    busy.value = true;
    error.value = "";
    const request = { expectedRevision: draft.value.revision, changes, secrets };
    // 请求副本仅保留到本次传输；输入控件立即清除秘密，不写入浏览器存储。
    for (const field of fields.value) if (secret(field)) values.value[field.key] = undefined;
    try {
        adopt(await bounded(props.client.editConfigurationDraft(draft.value.id, request)));
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
                props.client.addConfigurationAccount(draft.value.id, {
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
                props.client.removeConfigurationAccount(draft.value.id, {
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
                props.client.setConfigurationProtocol(draft.value.id, {
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
async function validate() {
    if (!draft.value || dirty.value) return;
    busy.value = true;
    error.value = "";
    try {
        validation.value = await bounded(
            props.client.validateConfigurationDraft(draft.value.id, draft.value.revision),
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
        const result = await bounded(
            props.client.configurationOperation(tracking.value.operationId),
        );
        if (
            result.id !== tracking.value.operationId ||
            result.validationId !== tracking.value.receiptId
        )
            throw new Error("identity");
        operation.value = result;
        if (result.status === "running" && !disposed) timer = setTimeout(query, 2000);
        if (result.status === "succeeded") {
            message.value = "配置已应用。网关原本停止时仍保持停止。";
            emit("applied");
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
            props.client.applyConfiguration(next.operationId, next.receiptId),
        );
    } catch (caught) {
        const recovery = await resolveConfigurationConflict({
            error: caught,
            newlySubmitted: true,
            submitted: next,
            current: () =>
                matchingConfigurationTracking(tracking.value, localStorage.getItem(STORAGE)),
            lookup: id => bounded(props.client.configurationOperation(id)),
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
            error.value = "版本已变化，本次应用未执行。请重新读取配置并创建新草稿，不会自动提交。";
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
</script>
<template>
    <section class="border-t border-border pt-6 space-y-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 class="text-lg font-medium">账号与运行配置</h2>
                <p class="text-sm text-fg-secondary mt-1">
                    先编辑草稿，再校验和应用。管理认证不属于运行配置。
                </p>
            </div>
            <UiButton :disabled="busy" @click="reload">{{
                dirty ? "放弃本地修改并重读" : "重新读取配置"
            }}</UiButton>
        </div>
        <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
        <p v-if="message" role="status" class="text-sm text-fg-secondary">{{ message }}</p>
        <p v-if="projection?.unknownPaths.length" class="text-sm text-amber-700">
            存在无法安全展示的字段，已在服务端保留。此页面不会用空值覆盖它们。
        </p>
        <div
            v-if="snapshot && (!draft || staleBase)"
            class="rounded-xl border border-border p-4 flex items-center justify-between gap-3">
            <p class="text-sm">读取到 {{ accounts.length }} 个账号。可创建草稿开始配置。</p>
            <UiButton
                variant="primary"
                :disabled="busy"
                @click="staleBase ? reload().then(create) : create()"
                >{{ staleBase ? "读取当前配置并创建新草稿" : "创建配置草稿" }}</UiButton
            >
        </div>
        <template v-if="draft">
            <p class="text-xs text-fg-tertiary">
                草稿 {{ draft.id }} · {{ dirty ? "有本地修改尚未保存" : "已保存" }}
            </p>
            <fieldset
                :disabled="locked || dirty"
                class="rounded-xl border border-border p-4 space-y-3">
                <legend class="px-2 text-sm font-medium">平台账号</legend>
                <div class="flex flex-wrap gap-2">
                    <select
                        v-model="platform"
                        aria-label="平台适配器"
                        class="rounded border border-border bg-surface px-3 py-2 text-sm">
                        <option value="">选择已安装平台</option>
                        <option v-for="name in adapters" :key="name" :value="name">
                            {{ name }}
                        </option>
                    </select>
                    <input
                        v-model="accountId"
                        aria-label="账号标识"
                        placeholder="账号标识，保留原始字符串"
                        class="rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <UiButton
                        :disabled="locked || dirty || !platform || !accountId"
                        @click="addAccount"
                        >添加空账号</UiButton
                    >
                </div>
                <p v-if="!adapters.length" class="text-sm text-fg-secondary">
                    尚未安装平台，请先在扩展安装中选择所需适配器。
                </p>
                <ul class="space-y-2">
                    <li
                        v-for="key in accounts"
                        :key="key"
                        class="flex items-center justify-between gap-2 text-sm">
                        <span>{{ key }}</span
                        ><UiButton :disabled="locked || dirty" @click="removeAccount(key)"
                            >从草稿删除</UiButton
                        >
                    </li>
                </ul>
            </fieldset>
            <fieldset
                :disabled="locked || dirty"
                class="rounded-xl border border-border p-4 space-y-3">
                <legend class="px-2 text-sm font-medium">协议出口（可选）</legend>
                <div class="flex flex-wrap gap-2">
                    <select
                        v-model="accountTarget"
                        aria-label="协议配置位置"
                        class="rounded border border-border bg-surface px-3 py-2 text-sm">
                        <option value="">协议默认值</option>
                        <option v-for="key in accounts" :key="key" :value="key">{{ key }}</option>
                    </select>
                    <select
                        v-model="protocol"
                        aria-label="输出协议"
                        class="rounded border border-border bg-surface px-3 py-2 text-sm">
                        <option value="">选择已安装协议</option>
                        <option v-for="name in protocols" :key="name" :value="name">
                            {{ name }}
                        </option>
                    </select>
                    <UiButton :disabled="locked || dirty || !protocol" @click="setProtocol(true)"
                        >添加配置</UiButton
                    ><UiButton :disabled="locked || dirty || !protocol" @click="setProtocol(false)"
                        >移除配置</UiButton
                    >
                </div>
                <p class="text-xs text-fg-secondary">
                    默认值不会自动为账号开启出口。账号协议需单独添加，应用后才生效。
                </p>
            </fieldset>
            <ControlConfigurationFields
                :groups="groups"
                :values="values"
                :modes="modes"
                :secret-states="draft.secretStates"
                :locked="locked"
                @change="change"
                @mode="mode" />
            <div class="flex flex-wrap gap-3">
                <UiButton :disabled="locked || !dirty" @click="save">保存草稿</UiButton>
                <UiButton :disabled="locked || dirty" @click="validate">校验配置</UiButton>
                <UiButton
                    variant="primary"
                    :disabled="locked || dirty || !validation?.valid"
                    @click="apply"
                    >应用已校验配置</UiButton
                >
            </div>
            <div v-if="validation" role="status" class="text-sm">
                <p>
                    {{
                        validation.valid
                            ? "校验通过，尚未应用。应用时会保持原有启停意图。"
                            : "校验未通过，请修改以下字段。"
                    }}
                </p>
                <ul class="mt-2 space-y-1">
                    <li v-for="(issue, index) in validation.issues" :key="index">
                        {{ issue.path.join(" / ") || "配置" }}：{{ issue.message }}
                    </li>
                </ul>
            </div>
        </template>
        <div
            v-if="tracking.operationId"
            class="rounded-xl border border-border p-4 space-y-3 text-sm">
            <p>应用操作 {{ tracking.operationId }}</p>
            <p>
                {{
                    operation?.status === "succeeded"
                        ? "应用成功"
                        : operation?.recoveryRequired
                          ? "需要人工对账，已停止自动恢复"
                          : operation?.rolledBack
                            ? "应用失败，已恢复原配置"
                            : operation?.status === "running"
                              ? "正在应用"
                              : "应用结果待确认"
                }}
            </p>
            <UiButton :disabled="busy" @click="query">查询原操作</UiButton>
            <UiButton
                v-if="operation && operation.status !== 'running' && !operation.recoveryRequired"
                :disabled="busy"
                @click="reload().then(create)"
                >读取当前配置并创建新草稿</UiButton
            >
        </div>
    </section>
</template>
