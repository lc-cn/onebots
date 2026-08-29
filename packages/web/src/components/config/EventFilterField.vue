<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconBraces, IconFilter, IconPlus, IconTrash } from "@tabler/icons-vue";
import UiButton from "../../ui/UiButton.vue";
import UiInput from "../../ui/UiInput.vue";
import UiSelect from "../../ui/UiSelect.vue";
import UiTextarea from "../../ui/UiTextarea.vue";
import type { ValidationRule } from "./types.js";
import {
    editorToEventFilters,
    eventFiltersToEditor,
    type EventFilterOperator,
    type EventFilterRow,
    type EventFilterEditorState,
} from "@onebots/core/event-filter";

const props = withDefaults(defineProps<{ rule: ValidationRule; disabled?: boolean }>(), {
    disabled: false,
});
const model = defineModel<unknown>();

const state = ref<EventFilterEditorState>({ match: "all", rules: [] });
const advanced = ref(false);
const advancedText = ref("");
const advancedError = ref("");

const fieldDefinitions = computed(() => props.rule.ui?.eventFields ?? []);
const fieldOptions = computed(() => [
    ...fieldDefinitions.value.map(field => ({ label: field.label, value: field.path })),
    { label: "自定义字段路径", value: "__custom__" },
]);
const matchOptions = [
    { label: "满足全部条件", value: "all" },
    { label: "满足任一条件", value: "any" },
];
const operatorOptions = [
    { label: "等于", value: "eq" },
    { label: "不等于", value: "neq" },
    { label: "属于其中之一", value: "in" },
    { label: "包含文本", value: "contains" },
    { label: "匹配正则", value: "regex" },
    { label: "大于", value: "gt" },
    { label: "大于等于", value: "gte" },
    { label: "小于", value: "lt" },
    { label: "小于等于", value: "lte" },
];

const syncFromModel = (value: unknown) => {
    if (typeof value === "string") {
        advanced.value = true;
        advancedText.value = value;
        advancedError.value = "";
        return;
    }
    const parsed = eventFiltersToEditor(value ?? {});
    if (parsed) {
        state.value = parsed;
        if (!advanced.value) advancedText.value = JSON.stringify(value ?? {}, null, 2);
    } else {
        advanced.value = true;
        advancedText.value = JSON.stringify(value ?? {}, null, 2);
        advancedError.value = "";
    }
};

watch(model, syncFromModel, { immediate: true, deep: true });

const commitVisual = () => {
    model.value = editorToEventFilters(state.value);
};

const addRule = () => {
    state.value.rules.push({ path: "type", operator: "eq", value: "message" });
    commitVisual();
};

const removeRule = (index: number) => {
    state.value.rules.splice(index, 1);
    commitVisual();
};

const updateRule = (index: number, patch: Partial<EventFilterRow>) => {
    state.value.rules[index] = { ...state.value.rules[index], ...patch };
    commitVisual();
};

const updateMatch = (value: string | number | boolean | undefined) => {
    state.value.match = value === "any" ? "any" : "all";
    commitVisual();
};

const updateField = (index: number, value: string | number | boolean | undefined) => {
    updateRule(index, { path: value === "__custom__" ? "" : String(value ?? "") });
};

const knownField = (path: string) =>
    fieldDefinitions.value.some(field => field.path === path) ? path : "__custom__";

const fieldChoices = (path: string) =>
    fieldDefinitions.value.find(field => field.path === path)?.choices ?? [];

const displayValue = (rule: EventFilterRow): string =>
    Array.isArray(rule.value) ? rule.value.join(", ") : String(rule.value ?? "");

const updateValue = (index: number, value: string | number | boolean | undefined) => {
    const operator = state.value.rules[index].operator;
    let normalized: unknown = value ?? "";
    if (operator === "in") {
        normalized = String(value ?? "")
            .split(",")
            .map(item => item.trim())
            .filter(Boolean);
    } else if (["gt", "gte", "lt", "lte"].includes(operator)) {
        const number = Number(value);
        normalized = Number.isFinite(number) ? number : value;
    }
    updateRule(index, { value: normalized });
};

const toggleAdvanced = () => {
    if (!advanced.value) {
        advancedText.value = JSON.stringify(model.value ?? {}, null, 2);
        advanced.value = true;
        return;
    }
    try {
        const value = advancedText.value.trim() ? JSON.parse(advancedText.value) : {};
        const parsed = eventFiltersToEditor(value);
        if (!parsed) return;
        state.value = parsed;
        model.value = value;
        advanced.value = false;
        advancedError.value = "";
    } catch {
        advancedError.value = "JSON 格式不正确，修正后才能返回可视化规则";
    }
};

const updateAdvanced = (value: string) => {
    advancedText.value = value;
    model.value = value;
    try {
        if (value.trim()) JSON.parse(value);
        advancedError.value = "";
    } catch {
        advancedError.value = "JSON 格式不正确";
    }
};
</script>

<template>
    <div class="space-y-3">
        <div
            v-if="!advanced && state.rules.length === 0"
            class="flex items-center justify-between gap-4 rounded-card border border-dashed border-border-strong bg-surface-raised/45 px-4 py-3">
            <div class="flex min-w-0 items-center gap-3">
                <span
                    class="grid size-8 shrink-0 place-items-center rounded-control bg-surface text-fg-tertiary">
                    <IconFilter :size="16" aria-hidden="true" />
                </span>
                <div>
                    <p class="text-sm font-medium text-fg">当前转发全部事件</p>
                    <p class="text-xs text-fg-tertiary">添加条件后，只有匹配的事件会进入此协议</p>
                </div>
            </div>
            <UiButton size="sm" :disabled="disabled" @click="addRule">
                <IconPlus :size="14" aria-hidden="true" />
                添加条件
            </UiButton>
        </div>

        <template v-if="!advanced && state.rules.length">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2 text-sm text-fg-secondary">
                    <span>转发符合</span>
                    <UiSelect
                        class="w-40"
                        :model-value="state.match"
                        :options="matchOptions"
                        :disabled="disabled"
                        @update:model-value="updateMatch" />
                    <span>的事件</span>
                </div>
                <UiButton size="sm" :disabled="disabled" @click="addRule">
                    <IconPlus :size="14" aria-hidden="true" />
                    添加条件
                </UiButton>
            </div>

            <article
                v-for="(ruleItem, index) in state.rules"
                :key="index"
                class="grid gap-2 rounded-card bg-surface-raised/60 p-3 sm:grid-cols-[1.15fr_0.9fr_1.25fr_auto]">
                <div class="space-y-2">
                    <UiSelect
                        :model-value="knownField(ruleItem.path)"
                        :options="fieldOptions"
                        :disabled="disabled"
                        @update:model-value="updateField(index, $event)" />
                    <UiInput
                        v-if="knownField(ruleItem.path) === '__custom__'"
                        :model-value="ruleItem.path"
                        placeholder="例如 sender.id.string"
                        :disabled="disabled"
                        @update:model-value="updateRule(index, { path: $event })" />
                </div>
                <UiSelect
                    :model-value="ruleItem.operator"
                    :options="operatorOptions"
                    :disabled="disabled"
                    @update:model-value="
                        updateRule(index, { operator: $event as EventFilterOperator })
                    " />
                <UiSelect
                    v-if="
                        fieldChoices(ruleItem.path).length &&
                        ['eq', 'neq'].includes(ruleItem.operator)
                    "
                    :model-value="ruleItem.value as string"
                    :options="fieldChoices(ruleItem.path)"
                    :disabled="disabled"
                    @update:model-value="updateValue(index, $event)" />
                <UiInput
                    v-else
                    :model-value="displayValue(ruleItem)"
                    :placeholder="ruleItem.operator === 'in' ? '多个值用逗号分隔' : '条件值'"
                    :disabled="disabled"
                    @update:model-value="updateValue(index, $event)" />
                <button
                    type="button"
                    class="grid size-9 place-items-center rounded-control text-fg-tertiary transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    :disabled="disabled"
                    aria-label="删除过滤条件"
                    @click="removeRule(index)">
                    <IconTrash :size="16" aria-hidden="true" />
                </button>
            </article>
        </template>

        <UiTextarea
            v-if="advanced"
            :model-value="advancedText"
            mono
            :rows="8"
            placeholder="输入 compileEventFilter 支持的过滤对象"
            :disabled="disabled"
            @update:model-value="updateAdvanced" />
        <p v-if="advanced && advancedError" class="text-xs text-danger">
            {{ advancedError }}
        </p>

        <button
            type="button"
            class="inline-flex items-center gap-1.5 text-xs font-medium text-fg-tertiary transition-colors hover:text-fg disabled:opacity-50"
            :disabled="disabled"
            @click="toggleAdvanced">
            <IconBraces :size="14" aria-hidden="true" />
            {{ advanced ? "返回可视化规则" : "高级 JSON" }}
        </button>
    </div>
</template>
