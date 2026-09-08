<script setup lang="ts">
import type { SchemaFieldDef, SchemaGroup } from "./config/types.js";
import SchemaField from "./SchemaField.vue";
import { fieldKey } from "./control-configuration-form.js";
const props = defineProps<{
    groups: SchemaGroup[];
    values: Record<string, unknown>;
    modes: Record<string, "keep" | "set" | "clear">;
    secretStates: Array<{ path: string[]; configured: boolean }>;
    locked: boolean;
}>();
const emit = defineEmits<{
    change: [field: SchemaFieldDef, value: unknown];
    mode: [field: SchemaFieldDef, value: string];
}>();
const secret = (field: SchemaFieldDef) =>
    props.secretStates.find(state => fieldKey(state.path) === field.key);
</script>
<template>
    <details
        v-for="group in groups"
        :key="group.key"
        open
        class="rounded-xl border border-border p-4">
        <summary class="cursor-pointer font-medium text-sm">{{ group.title }}</summary>
        <div class="grid sm:grid-cols-2 gap-4 mt-4">
            <div v-for="field in group.fields" :key="field.key" class="space-y-2">
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
                        @change="emit('mode', field, ($event.target as HTMLSelectElement).value)">
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
</template>
