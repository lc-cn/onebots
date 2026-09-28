<script setup lang="ts">
import { computed } from "vue";
import type { SchemaFieldDef } from "./config/types.js";
import { configurationSecret } from "./control-configuration-form.js";
import SchemaField from "./SchemaField.vue";

const props = defineProps<{
    field: SchemaFieldDef;
    value: unknown;
    mode?: "keep" | "set" | "clear";
    secretStates: Array<{ path: string[]; configured: boolean }>;
    locked: boolean;
}>();
const emit = defineEmits<{
    change: [field: SchemaFieldDef, value: unknown];
    mode: [field: SchemaFieldDef, value: string];
}>();
const secret = computed(() => configurationSecret(props.field, props.secretStates));
</script>

<template>
    <div :data-configuration-path="JSON.stringify(field.path)" class="space-y-2">
        <template v-if="secret">
            <label class="block text-sm"
                >{{ field.label }}
                <span class="text-xs text-fg-tertiary">{{
                    secret.configured ? "已设置" : "未设置"
                }}</span></label
            >
            <select
                :value="mode ?? 'keep'"
                :disabled="locked"
                :aria-label="`${field.label} 修改方式`"
                class="rounded border border-border bg-surface px-3 py-2 text-sm"
                @change="emit('mode', field, ($event.target as HTMLSelectElement).value)">
                <option value="keep">保留</option>
                <option value="set">替换</option>
                <option value="clear">清除</option>
            </select>
            <SchemaField
                v-if="mode === 'set'"
                :field="{ ...field, rule: { ...field.rule, sensitive: true } }"
                :model-value="value"
                :disabled="locked"
                @update:model-value="emit('change', field, $event)" />
        </template>
        <SchemaField
            v-else
            :field="field"
            :model-value="value"
            :disabled="locked"
            @update:model-value="emit('change', field, $event)" />
    </div>
</template>
