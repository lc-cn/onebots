<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconListCheck, IconPlus, IconTrash } from "@tabler/icons-vue";
import UiButton from "../../ui/UiButton.vue";
import UiSelect from "../../ui/UiSelect.vue";
import type { ValidationRule } from "./types.js";

const props = withDefaults(defineProps<{ rule: ValidationRule; disabled?: boolean }>(), {
    disabled: false,
});
const model = defineModel<unknown>();
const pending = ref<string | number | boolean>();

const entries = computed<Array<string | number | boolean>>(() =>
    Array.isArray(model.value)
        ? model.value.filter(
              (item): item is string | number | boolean =>
                  typeof item === "string" || typeof item === "number" || typeof item === "boolean",
          )
        : [],
);
const choices = computed(() =>
    (props.rule.choices || []).filter(
        (choice): choice is { label: string; value: string | number | boolean } =>
            typeof choice.value === "string" ||
            typeof choice.value === "number" ||
            typeof choice.value === "boolean",
    ),
);
const available = computed(() =>
    choices.value.filter(choice => !entries.value.includes(choice.value)),
);
const labelOf = (value: string | number | boolean) =>
    choices.value.find(choice => choice.value === value)?.label || String(value);

watch(
    available,
    options => {
        if (!options.some(option => option.value === pending.value)) {
            pending.value = options[0]?.value;
        }
    },
    { immediate: true },
);

const addEntry = () => {
    if (pending.value === undefined || entries.value.includes(pending.value)) return;
    model.value = [...entries.value, pending.value];
};

const removeEntry = (index: number) => {
    model.value = entries.value.filter((_, itemIndex) => itemIndex !== index);
};
</script>

<template>
    <div class="space-y-2.5">
        <div
            v-if="entries.length === 0"
            class="flex items-center gap-3 rounded-card border border-dashed border-border-strong bg-surface-raised/45 px-4 py-3">
            <span
                class="grid size-8 shrink-0 place-items-center rounded-control bg-surface text-fg-tertiary">
                <IconListCheck :size="16" aria-hidden="true" />
            </span>
            <div class="min-w-0">
                <p class="text-sm font-medium text-fg">尚未选择任何项目</p>
                <p class="text-xs text-fg-tertiary">从下方列表逐项添加，可随时删除和调整</p>
            </div>
        </div>

        <div v-if="entries.length" class="grid gap-2 sm:grid-cols-2">
            <div
                v-for="(entry, index) in entries"
                :key="String(entry)"
                class="flex items-center justify-between gap-3 rounded-control bg-surface-raised/60 px-3 py-2">
                <span class="min-w-0 truncate text-sm text-fg">{{ labelOf(entry) }}</span>
                <button
                    type="button"
                    :disabled="disabled"
                    class="grid size-8 shrink-0 place-items-center rounded-control text-fg-tertiary transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    :aria-label="`删除 ${labelOf(entry)}`"
                    @click="removeEntry(index)">
                    <IconTrash :size="15" aria-hidden="true" />
                </button>
            </div>
        </div>

        <div v-if="available.length" class="flex items-center gap-2">
            <UiSelect
                v-model="pending"
                class="min-w-0 flex-1"
                :options="available"
                placeholder="选择要添加的项目"
                :disabled="disabled" />
            <UiButton size="sm" :disabled="disabled || pending === undefined" @click="addEntry">
                <IconPlus :size="14" aria-hidden="true" />
                添加
            </UiButton>
        </div>
        <p v-else-if="entries.length" class="text-xs text-fg-tertiary">所有可选项目均已添加</p>
    </div>
</template>
