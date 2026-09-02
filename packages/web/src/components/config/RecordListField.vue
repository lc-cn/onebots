<script setup lang="ts">
import { computed } from "vue";
import { IconPlus, IconTableRow, IconTrash } from "@tabler/icons-vue";
import UiButton from "../../ui/UiButton.vue";
import UiInput from "../../ui/UiInput.vue";
import UiNumberInput from "../../ui/UiNumberInput.vue";
import UiSelect from "../../ui/UiSelect.vue";
import UiSwitch from "../../ui/UiSwitch.vue";
import type { ValidationRule } from "./types.js";

const props = withDefaults(defineProps<{ rule: ValidationRule; disabled?: boolean }>(), {
    disabled: false,
});
const model = defineModel<unknown>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const entries = computed<Record<string, unknown>[]>(() =>
    Array.isArray(model.value) ? model.value.map(entry => (isRecord(entry) ? entry : {})) : [],
);
const fields = computed(() => props.rule.ui?.fields ?? []);

const replaceEntries = (next: Record<string, unknown>[]) => {
    model.value = next;
};

const updateField = (index: number, key: string, value: unknown) => {
    const next = entries.value.map(entry => ({ ...entry }));
    const entry = next[index];
    if (!entry) return;
    if (value === "" || value === undefined) delete entry[key];
    else entry[key] = value;
    replaceEntries(next);
};

const addEntry = () => replaceEntries([...entries.value, {}]);
const removeEntry = (index: number) =>
    replaceEntries(entries.value.filter((_, itemIndex) => itemIndex !== index));

const stringValue = (entry: Record<string, unknown>, key: string) =>
    typeof entry[key] === "string" ? entry[key] : "";
const numberValue = (entry: Record<string, unknown>, key: string) =>
    typeof entry[key] === "number" ? entry[key] : undefined;
const choiceValue = (entry: Record<string, unknown>, key: string) => {
    const value = entry[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? value
        : undefined;
};
const visibleFields = (entry: Record<string, unknown>) =>
    fields.value.filter(field => {
        const condition = field.visibleWhen;
        return (
            !condition ||
            condition.oneOf.includes(entry[condition.path] as string | number | boolean)
        );
    });
const choiceOptions = (field: (typeof fields.value)[number]) =>
    (field.choices || []).map(choice => ({ label: choice.label, value: choice.value }));
</script>

<template>
    <div class="space-y-2.5">
        <div
            v-if="entries.length === 0"
            class="flex items-center justify-between gap-4 rounded-card border border-dashed border-border-strong bg-surface-raised/45 px-4 py-3">
            <div class="flex min-w-0 items-center gap-3">
                <span
                    class="grid size-8 shrink-0 place-items-center rounded-control bg-surface text-fg-tertiary">
                    <IconTableRow :size="16" aria-hidden="true" />
                </span>
                <div class="min-w-0">
                    <p class="text-sm font-medium text-fg">
                        尚未配置{{ rule.ui?.itemLabel || "项目" }}
                    </p>
                    <p class="text-xs text-fg-tertiary">逐项添加结构化数据，无需手写 JSON</p>
                </div>
            </div>
            <UiButton size="sm" :disabled="disabled" @click="addEntry">
                <IconPlus :size="14" aria-hidden="true" />
                {{ rule.ui?.addLabel || "添加项目" }}
            </UiButton>
        </div>

        <article
            v-for="(entry, index) in entries"
            :key="index"
            class="rounded-card bg-surface-raised/60 p-3">
            <div class="mb-3 flex items-center justify-between gap-3">
                <span class="text-xs font-semibold text-fg-secondary">
                    {{ rule.ui?.itemLabel || "项目" }} {{ index + 1 }}
                </span>
                <button
                    type="button"
                    :disabled="disabled"
                    class="grid size-8 place-items-center rounded-control text-fg-tertiary transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    :aria-label="`删除${rule.ui?.itemLabel || '项目'} ${index + 1}`"
                    @click="removeEntry(index)">
                    <IconTrash :size="15" aria-hidden="true" />
                </button>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
                <label v-for="field in visibleFields(entry)" :key="field.key" class="space-y-1.5">
                    <span class="text-xs font-medium text-fg-secondary">{{ field.label }}</span>
                    <UiNumberInput
                        v-if="field.type === 'number'"
                        :model-value="numberValue(entry, field.key)"
                        :disabled="disabled"
                        @update:model-value="updateField(index, field.key, $event)" />
                    <UiSwitch
                        v-else-if="field.type === 'boolean'"
                        :model-value="entry[field.key] === true"
                        :disabled="disabled"
                        @update:model-value="updateField(index, field.key, $event)" />
                    <UiSelect
                        v-else-if="field.choices?.length"
                        :model-value="choiceValue(entry, field.key)"
                        :options="choiceOptions(field)"
                        :placeholder="field.placeholder || '请选择'"
                        :disabled="disabled"
                        @update:model-value="updateField(index, field.key, $event)" />
                    <UiInput
                        v-else
                        :model-value="stringValue(entry, field.key)"
                        :type="field.sensitive ? 'password' : 'text'"
                        :placeholder="field.placeholder"
                        :disabled="disabled"
                        @update:model-value="updateField(index, field.key, $event)" />
                    <span v-if="field.description" class="block text-xs text-fg-tertiary">
                        {{ field.description }}
                    </span>
                </label>
            </div>
        </article>

        <UiButton v-if="entries.length" size="sm" :disabled="disabled" @click="addEntry">
            <IconPlus :size="14" aria-hidden="true" />
            {{ rule.ui?.addLabel || "添加项目" }}
        </UiButton>
    </div>
</template>
