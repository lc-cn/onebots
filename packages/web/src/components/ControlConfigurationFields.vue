<script setup lang="ts">
import type { SchemaFieldDef } from "./config/types.js";
import SchemaField from "./SchemaField.vue";
import { configurationSecret, type ConfigurationFormGroup } from "./control-configuration-form.js";
import UiButton from "../ui/UiButton.vue";
import { isSchemaFieldVisible } from "./config/utils.js";
import { configurationFieldTier } from "./control-configuration-layout.js";
const props = defineProps<{
    groups: ConfigurationFormGroup[];
    values: Record<string, unknown>;
    modes: Record<string, "keep" | "set" | "clear">;
    secretStates: Array<{ path: string[]; configured: boolean }>;
    locked: boolean;
    listLocked: boolean;
    revealPath?: string[];
}>();
const emit = defineEmits<{
    change: [field: SchemaFieldDef, value: unknown];
    mode: [field: SchemaFieldDef, value: string];
    list: [path: string[], action: "append" | "remove", index?: number];
}>();
const secret = (field: SchemaFieldDef) => configurationSecret(field, props.secretStates);
const visibleFields = (group: ConfigurationFormGroup) =>
    group.fields.filter(field => isSchemaFieldVisible(field, props.values));
const primaryFields = (group: ConfigurationFormGroup) =>
    visibleFields(group).filter(field => configurationFieldTier(field) === "primary");
const advancedFields = (group: ConfigurationFormGroup) =>
    visibleFields(group).filter(field => !primaryFields(group).includes(field));
const sectionDefinitions = [
    { key: "transport", title: "服务入口", detail: "选择下游连接 OneBots 的方式" },
    { key: "delivery", title: "事件推送", detail: "配置 Webhook 与反向连接目标" },
    { key: "credentials", title: "身份与鉴权", detail: "保护协议入口和推送请求" },
    { key: "filter", title: "事件筛选", detail: "控制哪些事件进入这个出口" },
] as const;
const sectionFields = (group: ConfigurationFormGroup, key: string) =>
    visibleFields(group).filter(field => field.rule.ui?.section === key);
const unsectionedPrimaryFields = (group: ConfigurationFormGroup) =>
    primaryFields(group).filter(
        field => !field.rule.ui?.section || field.rule.ui.section === "advanced",
    );
const revealsAdvanced = (group: ConfigurationFormGroup) =>
    Boolean(
        props.revealPath &&
        advancedFields(group).some(field =>
            field.path.every((part, index) => props.revealPath?.[index] === part),
        ),
    );
</script>
<template>
    <section v-for="group in groups" :key="group.key" class="configuration-schema-group">
        <header class="configuration-schema-heading">
            <div>
                <p class="configuration-kicker">配置项</p>
                <h3>{{ group.title }}</h3>
            </div>
            <span>{{ visibleFields(group).length }} 个字段</span>
        </header>
        <p v-for="notice in group.notices" :key="notice" class="configuration-notice">
            {{ notice }}
        </p>
        <div v-if="unsectionedPrimaryFields(group).length" class="configuration-field-section">
            <div class="configuration-field-heading">
                <h4>
                    {{
                        unsectionedPrimaryFields(group).some(field => field.rule.required)
                            ? "必要配置"
                            : "主要设置"
                    }}
                </h4>
                <p>优先完成这些字段，再按需调整其余选项。</p>
            </div>
            <div class="configuration-field-grid">
                <div
                    v-for="field in unsectionedPrimaryFields(group)"
                    :key="field.key"
                    :data-configuration-path="JSON.stringify(field.path)"
                    class="space-y-2">
                    <template v-if="secret(field)">
                        <label class="block text-sm"
                            >{{ field.label }}
                            <span class="text-xs text-fg-tertiary">{{
                                secret(field)?.configured ? "已设置" : "未设置"
                            }}</span></label
                        >
                        <select
                            :value="modes[field.key] ?? 'keep'"
                            :disabled="locked"
                            :aria-label="`${field.label} 修改方式`"
                            class="rounded border border-border bg-surface px-3 py-2 text-sm"
                            @change="
                                emit('mode', field, ($event.target as HTMLSelectElement).value)
                            ">
                            <option value="keep">保留</option>
                            <option value="set">替换</option>
                            <option value="clear">清除</option>
                        </select>
                        <SchemaField
                            v-if="modes[field.key] === 'set'"
                            :field="{ ...field, rule: { ...field.rule, sensitive: true } }"
                            :model-value="values[field.key]"
                            :disabled="locked"
                            @update:model-value="emit('change', field, $event)" />
                    </template>
                    <SchemaField
                        v-else
                        :field="field"
                        :model-value="values[field.key]"
                        :disabled="locked"
                        @update:model-value="emit('change', field, $event)" />
                </div>
            </div>
        </div>
        <section
            v-for="section in sectionDefinitions.filter(
                item => sectionFields(group, item.key).length,
            )"
            :key="section.key"
            class="configuration-field-section">
            <div class="configuration-field-heading">
                <h4>{{ section.title }}</h4>
                <p>{{ section.detail }}</p>
            </div>
            <div class="configuration-field-grid">
                <div
                    v-for="field in sectionFields(group, section.key)"
                    :key="field.key"
                    :data-configuration-path="JSON.stringify(field.path)"
                    class="space-y-2">
                    <template v-if="secret(field)">
                        <label class="block text-sm"
                            >{{ field.label }}
                            <span class="text-xs text-fg-tertiary">{{
                                secret(field)?.configured ? "已设置" : "未设置"
                            }}</span></label
                        >
                        <select
                            :value="modes[field.key] ?? 'keep'"
                            :disabled="locked"
                            :aria-label="`${field.label} 修改方式`"
                            class="rounded border border-border bg-surface px-3 py-2 text-sm"
                            @change="
                                emit('mode', field, ($event.target as HTMLSelectElement).value)
                            ">
                            <option value="keep">保留</option>
                            <option value="set">替换</option>
                            <option value="clear">清除</option>
                        </select>
                        <SchemaField
                            v-if="modes[field.key] === 'set'"
                            :field="{ ...field, rule: { ...field.rule, sensitive: true } }"
                            :model-value="values[field.key]"
                            :disabled="locked"
                            @update:model-value="emit('change', field, $event)" />
                    </template>
                    <SchemaField
                        v-else
                        :field="field"
                        :model-value="values[field.key]"
                        :disabled="locked"
                        @update:model-value="emit('change', field, $event)" />
                </div>
            </div>
        </section>
        <details
            v-if="advancedFields(group).length || group.lists.length"
            :open="revealsAdvanced(group)"
            class="configuration-advanced">
            <summary>
                更多设置 <span>{{ advancedFields(group).length + group.lists.length }} 项</span>
            </summary>
            <div v-for="list in group.lists" :key="list.key" class="configuration-list-field">
                <div class="flex justify-between items-center gap-2">
                    <span class="text-sm">{{ list.label }} · {{ list.count }} 项</span>
                    <UiButton
                        :disabled="listLocked || Boolean(list.readonlyReason)"
                        @click="emit('list', list.path, 'append')"
                        >添加空白项</UiButton
                    >
                </div>
                <div
                    v-for="index in list.count"
                    :key="index"
                    class="flex justify-between items-center text-xs">
                    <span>第 {{ index }} 项</span>
                    <UiButton
                        :aria-label="`删除 ${list.label} 第 ${index} 项`"
                        :disabled="listLocked || Boolean(list.readonlyReason)"
                        @click="emit('list', list.path, 'remove', index - 1)"
                        >删除此项</UiButton
                    >
                </div>
                <p v-if="list.readonlyReason" class="text-xs text-fg-tertiary">
                    {{ list.readonlyReason }}
                </p>
                <p v-if="listLocked && !locked" class="text-xs text-fg-tertiary">
                    请先保存字段修改，再添加或删除列表项。
                </p>
            </div>
            <div class="configuration-field-grid">
                <div
                    v-for="field in advancedFields(group)"
                    :key="field.key"
                    :data-configuration-path="JSON.stringify(field.path)"
                    class="space-y-2">
                    <template v-if="secret(field)">
                        <label class="block text-sm"
                            >{{ field.label }}
                            <span class="text-xs text-fg-tertiary">{{
                                secret(field)?.configured ? "已设置" : "未设置"
                            }}</span></label
                        >
                        <select
                            :value="modes[field.key] ?? 'keep'"
                            :disabled="locked"
                            :aria-label="`${field.label} 修改方式`"
                            class="rounded border border-border bg-surface px-3 py-2 text-sm"
                            @change="
                                emit('mode', field, ($event.target as HTMLSelectElement).value)
                            ">
                            <option value="keep">保留</option>
                            <option value="set">替换</option>
                            <option value="clear">清除</option>
                        </select>
                        <SchemaField
                            v-if="modes[field.key] === 'set'"
                            :field="{ ...field, rule: { ...field.rule, sensitive: true } }"
                            :model-value="values[field.key]"
                            :disabled="locked"
                            @update:model-value="emit('change', field, $event)" />
                    </template>
                    <SchemaField
                        v-else
                        :field="field"
                        :model-value="values[field.key]"
                        :disabled="locked"
                        @update:model-value="emit('change', field, $event)" />
                </div>
            </div>
        </details>
        <p v-if="!visibleFields(group).length && !group.lists.length" class="configuration-empty">
            这个对象没有需要填写的额外参数。
        </p>
    </section>
</template>
