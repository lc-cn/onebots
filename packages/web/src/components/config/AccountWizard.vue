<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import { useRouter } from "vue-router";
import SchemaField from "../SchemaField.vue";
import UiAlert from "../../ui/UiAlert.vue";
import UiButton from "../../ui/UiButton.vue";
import UiField from "../../ui/UiField.vue";
import UiInput from "../../ui/UiInput.vue";
import UiSelect from "../../ui/UiSelect.vue";
import UiSwitch from "../../ui/UiSwitch.vue";
import UiModal from "../../ui/UiModal.vue";
import UiSteps from "../../ui/UiSteps.vue";
import UiTabs from "../../ui/UiTabs.vue";
import UiEmpty from "../../ui/UiEmpty.vue";
import { buildApiUrl } from "../../config";
import { authFetch } from "../../composables/useAuth";
import { useToast } from "../../ui/toast.js";
import type { SchemaBundle, SchemaGroup, SchemaFieldDef, AccountRow } from "./types.js";
import {
    buildSchemaFields,
    deleteValueByPath,
    getValueByPath,
    setValueByPath,
    resolveStructuredFieldDisplay,
    resolveSchemaFieldInitialValue,
    parseStructuredFieldValue,
    isSchemaFieldVisible,
    protocolTitle,
} from "./utils";
import { buildProtocolFieldLayout } from "./protocol-layout";
import {
    getAccountProtocolSelectionState,
    resolveRequestedProtocol,
} from "./account-protocol-selection.js";
import {
    getAccountAdapterSelectionState,
    type SchemaLoadStatus,
} from "./account-adapter-selection.js";

const props = defineProps<{
    schema: SchemaBundle | null;
    schemaStatus: SchemaLoadStatus;
}>();

const emit = defineEmits<{
    saved: [];
    reloadSchema: [];
}>();

const toast = useToast();
const router = useRouter();

const dialogVisible = ref(false);
const dialogTitle = ref("新增账号");
const isEdit = ref(false);
const accountForm = ref({ platform: "", account_id: "" });
const accountOriginalConfig = ref<Record<string, unknown>>({});
const accountFormModel = reactive<Record<string, unknown>>({});
const protocolGroups = ref<SchemaGroup[]>([]);
const adapterFields = ref<SchemaFieldDef[]>([]);
const protocolEnabled = reactive<Record<string, boolean>>({});

const visibleFields = (fields: SchemaFieldDef[]) =>
    fields.filter(field => isSchemaFieldVisible(field, accountFormModel));

const steps = [
    { key: "basic", label: "基本信息" },
    { key: "adapter", label: "平台配置" },
    { key: "protocol", label: "协议配置" },
];
const currentStep = ref(0);
const activeProtocolTab = ref("");
const preferredProtocol = ref("");

const protocolTabs = computed(() =>
    protocolGroups.value.map(group => ({ key: group.key, label: group.title })),
);

const protocolSelection = computed(() =>
    getAccountProtocolSelectionState(
        protocolGroups.value.map(group => group.key),
        protocolEnabled,
    ),
);

const protocolLayouts = computed(() =>
    Object.fromEntries(
        protocolGroups.value.map(group => [group.key, buildProtocolFieldLayout(group)]),
    ),
);

const platformOptions = computed(() =>
    Object.keys(props.schema?.adapters || {}).map(name => ({ label: name, value: name })),
);

const adapterSelection = computed(() =>
    getAccountAdapterSelectionState(
        props.schemaStatus,
        platformOptions.value.map(option => option.value),
        accountForm.value.platform,
    ),
);

const buildProtocolGroups = () => {
    if (!props.schema?.protocols) {
        protocolGroups.value = [];
        return;
    }
    const groups: SchemaGroup[] = [];
    Object.entries(props.schema.protocols).forEach(([protocolKey, protocolSchema]) => {
        groups.push({
            key: protocolKey,
            title: protocolTitle(protocolKey),
            fields: buildSchemaFields(protocolSchema, [protocolKey]),
        });
        if (protocolEnabled[protocolKey] === undefined) {
            protocolEnabled[protocolKey] = false;
        }
    });
    protocolGroups.value = groups;
};

const buildAdapterFields = (platform: string) => {
    const adapterSchema = props.schema?.adapters?.[platform];
    if (!adapterSchema) {
        adapterFields.value = [];
        return;
    }
    adapterFields.value = buildSchemaFields(adapterSchema, []).filter(
        field => field.path.join(".") !== "account_id",
    );
};

const syncFormModel = (configObject: Record<string, unknown>) => {
    protocolGroups.value.forEach(group => {
        const enabled = Boolean(configObject[group.key]);
        protocolEnabled[group.key] = enabled;
        group.fields.forEach(field => {
            const currentValue = getValueByPath(configObject, field.path);
            if (field.rule.type === "object" || field.rule.type === "array") {
                accountFormModel[field.key] = resolveStructuredFieldDisplay(
                    currentValue,
                    field.rule,
                );
                return;
            }
            accountFormModel[field.key] = resolveSchemaFieldInitialValue(configObject, field);
        });
    });

    adapterFields.value.forEach(field => {
        const currentValue = getValueByPath(configObject, field.path);
        if (field.rule.type === "object" || field.rule.type === "array") {
            accountFormModel[field.key] = resolveStructuredFieldDisplay(currentValue, field.rule);
            return;
        }
        accountFormModel[field.key] = resolveSchemaFieldInitialValue(configObject, field);
    });
};

const applyPreferredProtocol = () => {
    const requestedProtocol = resolveRequestedProtocol(
        protocolGroups.value.map(group => group.key),
        preferredProtocol.value,
    );
    if (!requestedProtocol) return null;
    protocolEnabled[requestedProtocol] = true;
    activeProtocolTab.value = requestedProtocol;
    return requestedProtocol;
};

const goNextStep = () => {
    if (currentStep.value === 0) {
        if (!adapterSelection.value.valid) {
            toast.warning(adapterSelection.value.description);
            return;
        }
        if (!accountForm.value.platform) {
            toast.warning("请先选择平台");
            return;
        }
        if (!accountForm.value.account_id?.trim()) {
            toast.warning("请填写账号ID");
            return;
        }
    }
    if (currentStep.value < steps.length - 1) currentStep.value += 1;
};

const goPrevStep = () => {
    if (currentStep.value > 0) currentStep.value -= 1;
};

const onSelectStep = (index: number) => {
    // 仅编辑模式允许跳步；新增按线性流程走
    if (isEdit.value) currentStep.value = index;
};

const handleSubmit = async () => {
    if (!adapterSelection.value.valid) {
        currentStep.value = 0;
        toast.warning(adapterSelection.value.description);
        return;
    }
    if (!accountForm.value.platform || !accountForm.value.account_id) {
        toast.warning("请填写平台与账号ID");
        return;
    }
    if (!protocolSelection.value.valid) {
        currentStep.value = steps.length - 1;
        toast.warning(protocolSelection.value.description);
        return;
    }

    const configObject = JSON.parse(JSON.stringify(accountOriginalConfig.value || {})) as Record<
        string,
        unknown
    >;

    for (const group of protocolGroups.value) {
        if (!protocolEnabled[group.key]) {
            delete configObject[group.key];
            continue;
        }
        for (const field of group.fields) {
            if (!isSchemaFieldVisible(field, accountFormModel)) {
                deleteValueByPath(configObject, field.path);
                continue;
            }
            let value = accountFormModel[field.key];
            if (field.rule.type === "object" || field.rule.type === "array") {
                const parsed = parseStructuredFieldValue(value, field.rule, field.label);
                if (!parsed.ok) {
                    toast.error(parsed.message);
                    return;
                }
                value = parsed.value;
            }
            setValueByPath(configObject, field.path, value);
        }
    }

    for (const field of adapterFields.value) {
        if (!isSchemaFieldVisible(field, accountFormModel)) {
            deleteValueByPath(configObject, field.path);
            continue;
        }
        let value = accountFormModel[field.key];
        if (field.rule.type === "object" || field.rule.type === "array") {
            const parsed = parseStructuredFieldValue(value, field.rule, field.label);
            if (!parsed.ok) {
                toast.error(parsed.message);
                return;
            }
            value = parsed.value;
        }
        setValueByPath(configObject, field.path, value);
    }

    const payload = {
        ...configObject,
        platform: accountForm.value.platform,
        account_id: accountForm.value.account_id,
    };

    const url = isEdit.value ? "/api/edit" : "/api/add";
    const response = await authFetch(buildApiUrl(url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (response.ok) {
        toast.success("保存成功");
        dialogVisible.value = false;
        emit("saved");
    } else {
        const result = await response.json().catch(() => ({}));
        toast.error(result.message || "保存失败");
    }
};

const goToProtocolExtensions = () => {
    dialogVisible.value = false;
    void router.push("/extensions?type=protocol");
};

const handleAdapterAction = () => {
    if (adapterSelection.value.action === "retry") {
        emit("reloadSchema");
        return;
    }
    dialogVisible.value = false;
    void router.push("/extensions?type=adapter");
};

const openAdd = (platform = "", protocol = "") => {
    dialogTitle.value = "新增账号";
    isEdit.value = false;
    preferredProtocol.value = protocol;
    accountOriginalConfig.value = {};
    accountForm.value = { platform, account_id: "" };
    buildAdapterFields(platform);
    syncFormModel({});
    currentStep.value = 0;
    activeProtocolTab.value = applyPreferredProtocol() ?? protocolGroups.value[0]?.key ?? "";
    dialogVisible.value = true;
};

const openEdit = (row: AccountRow, protocol = "") => {
    dialogTitle.value = "编辑账号";
    isEdit.value = true;
    preferredProtocol.value = protocol;
    accountOriginalConfig.value = JSON.parse(JSON.stringify(row.config || {})) as Record<
        string,
        unknown
    >;
    accountForm.value = { platform: row.platform, account_id: row.account_id };
    buildAdapterFields(row.platform);
    syncFormModel(row.config || {});
    const requestedProtocol = applyPreferredProtocol();
    currentStep.value = requestedProtocol ? steps.length - 1 : 0;
    activeProtocolTab.value = requestedProtocol ?? protocolGroups.value[0]?.key ?? "";
    dialogVisible.value = true;
};

watch(
    () => props.schema,
    () => {
        buildProtocolGroups();
    },
    { immediate: true },
);

watch(
    () => accountForm.value.platform,
    platform => {
        if (!platform) return;
        buildAdapterFields(platform);
        syncFormModel(accountOriginalConfig.value || {});
        applyPreferredProtocol();
    },
);

defineExpose({ openAdd, openEdit });
</script>

<template>
    <UiModal v-model="dialogVisible" :title="dialogTitle" width="720px">
        <div class="flex flex-col gap-5">
            <UiSteps
                :steps="steps"
                :current="currentStep"
                :clickable="isEdit"
                @select="onSelectStep" />

            <!-- 第一步：平台与账号ID -->
            <div v-show="currentStep === 0" class="flex flex-col gap-4">
                <UiAlert
                    v-if="!adapterSelection.valid"
                    :variant="adapterSelection.variant"
                    :title="adapterSelection.title">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span>{{ adapterSelection.description }}</span>
                        <UiButton
                            v-if="adapterSelection.actionLabel"
                            size="sm"
                            variant="secondary"
                            @click="handleAdapterAction">
                            {{ adapterSelection.actionLabel }}
                        </UiButton>
                    </div>
                </UiAlert>
                <UiField
                    label="平台"
                    required
                    hint="选择要接入的 IM 平台，下一步会展示该平台所需的配置项">
                    <UiSelect
                        v-model="accountForm.platform"
                        :options="platformOptions"
                        placeholder="选择平台"
                        :disabled="isEdit || !adapterSelection.valid" />
                </UiField>
                <UiField label="账号ID" required hint="账号在本网关中的唯一标识，如 my_bot">
                    <UiInput
                        v-model="accountForm.account_id"
                        placeholder="例如: my_bot"
                        :disabled="isEdit" />
                </UiField>
            </div>

            <!-- 第二步：平台配置 -->
            <div v-show="currentStep === 1" class="flex flex-col gap-4">
                <template v-if="adapterFields.length">
                    <SchemaField
                        v-for="field in visibleFields(adapterFields)"
                        :key="field.key"
                        v-model="accountFormModel[field.key]"
                        :field="field" />
                </template>
                <UiEmpty v-else title="该平台无需额外配置" description="可直接进入下一步配置协议" />
            </div>

            <!-- 第三步：协议配置（页签） -->
            <div v-show="currentStep === 2" class="flex flex-col gap-3">
                <UiAlert
                    v-if="!protocolSelection.valid"
                    variant="warning"
                    :title="protocolSelection.title">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span>{{ protocolSelection.description }}</span>
                        <UiButton
                            v-if="protocolSelection.actionLabel"
                            size="sm"
                            variant="secondary"
                            @click="goToProtocolExtensions">
                            {{ protocolSelection.actionLabel }}
                        </UiButton>
                    </div>
                </UiAlert>
                <template v-if="protocolGroups.length">
                    <UiTabs v-model="activeProtocolTab" :tabs="protocolTabs" />
                    <div
                        v-for="group in protocolGroups"
                        v-show="activeProtocolTab === group.key"
                        :key="group.key"
                        class="flex flex-col gap-4 pt-2">
                        <div
                            class="flex items-center justify-between rounded-card bg-accent-soft px-4 py-3">
                            <div>
                                <div class="text-sm font-semibold text-fg">{{ group.title }}</div>
                                <div class="mt-0.5 text-xs text-fg-secondary">
                                    开启后可为当前账号覆盖全局协议默认值
                                </div>
                            </div>
                            <UiSwitch v-model="protocolEnabled[group.key]" />
                        </div>

                        <section
                            v-for="section in protocolLayouts[group.key]?.sections || []"
                            :key="section.key"
                            class="space-y-3">
                            <div v-if="section.title">
                                <h4 class="text-sm font-semibold text-fg">{{ section.title }}</h4>
                                <p
                                    v-if="section.description"
                                    class="mt-0.5 text-xs text-fg-tertiary">
                                    {{ section.description }}
                                </p>
                            </div>
                            <div
                                :class="
                                    section.columns ? 'grid gap-3 sm:grid-cols-2' : 'space-y-3'
                                ">
                                <SchemaField
                                    v-for="field in visibleFields(section.fields)"
                                    :key="field.key"
                                    v-model="accountFormModel[field.key]"
                                    :field="field"
                                    :disabled="!protocolEnabled[group.key]" />
                            </div>
                        </section>

                        <details
                            v-if="protocolLayouts[group.key]?.advanced.length"
                            class="group rounded-card border border-border px-4 py-3">
                            <summary
                                class="cursor-pointer text-sm font-medium text-fg-secondary marker:text-fg-tertiary">
                                高级设置
                                <span class="ml-1 text-xs font-normal text-fg-tertiary">
                                    {{ protocolLayouts[group.key]?.advanced.length }} 项
                                </span>
                            </summary>
                            <div class="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                                <SchemaField
                                    v-for="field in visibleFields(
                                        protocolLayouts[group.key]?.advanced || [],
                                    )"
                                    :key="field.key"
                                    v-model="accountFormModel[field.key]"
                                    :field="field"
                                    :disabled="!protocolEnabled[group.key]" />
                            </div>
                        </details>
                    </div>
                </template>
                <UiEmpty
                    v-else
                    title="暂无可用协议"
                    description="安装至少一个开放协议并重启后，再为账号配置消息出口" />
            </div>
        </div>

        <template #footer>
            <div class="flex w-full items-center justify-between gap-2">
                <UiButton variant="ghost" @click="dialogVisible = false">取消</UiButton>
                <div class="flex items-center gap-2">
                    <UiButton v-if="currentStep > 0" variant="secondary" @click="goPrevStep">
                        上一步
                    </UiButton>
                    <UiButton
                        v-if="currentStep < steps.length - 1"
                        variant="primary"
                        @click="goNextStep">
                        下一步
                    </UiButton>
                    <UiButton v-else variant="primary" @click="handleSubmit">保存</UiButton>
                </div>
            </div>
        </template>
    </UiModal>
</template>
