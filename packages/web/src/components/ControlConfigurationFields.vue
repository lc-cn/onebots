<script setup lang="ts">
import type { SchemaFieldDef } from "./config/types.js";
import SchemaField from "./SchemaField.vue";
import { configurationSecret, type ConfigurationFormGroup } from "./control-configuration-form.js";
import UiButton from "../ui/UiButton.vue";
import { isSchemaFieldVisible } from "./config/utils.js";
const props = defineProps<{
    groups: ConfigurationFormGroup[];
    values: Record<string, unknown>;
    modes: Record<string, "keep" | "set" | "clear">;
    secretStates: Array<{ path: string[]; configured: boolean }>;
    locked: boolean;
    listLocked: boolean;
}>();
const emit = defineEmits<{
    change: [field: SchemaFieldDef, value: unknown];
    mode: [field: SchemaFieldDef, value: string];
    list: [path: string[], action: "append" | "remove", index?: number];
}>();
const secret = (field: SchemaFieldDef) => configurationSecret(field, props.secretStates);
</script>
<template>
    <details
        v-for="group in groups"
        :key="group.key"
        open
        class="rounded-xl border border-border p-4">
        <summary class="cursor-pointer font-medium text-sm">{{ group.title }}</summary>
        <p v-for="notice in group.notices" :key="notice" class="mt-3 text-sm text-fg-secondary">
            {{ notice }}
        </p>
        <div
            v-for="list in group.lists"
            :key="list.key"
            class="mt-4 rounded border border-border p-3 space-y-2">
            <div class="flex justify-between items-center gap-2">
                <span class="text-sm">{{ list.label }} · {{ list.count }} 项</span
                ><UiButton
                    :disabled="listLocked || Boolean(list.readonlyReason)"
                    @click="emit('list', list.path, 'append')"
                    >添加空白项</UiButton
                >
            </div>
            <div
                v-for="index in list.count"
                :key="index"
                class="flex justify-between items-center text-xs">
                <span>第 {{ index }} 项</span
                ><UiButton
                    :disabled="listLocked || Boolean(list.readonlyReason)"
                    @click="emit('list', list.path, 'remove', index - 1)"
                    >从草稿删除此项</UiButton
                >
            </div>
            <p v-if="list.readonlyReason" class="text-xs text-fg-tertiary">
                {{ list.readonlyReason }}
            </p>
            <p v-if="listLocked && !locked" class="text-xs text-fg-tertiary">
                请先保存字段修改，再添加或删除列表项。
            </p>
        </div>
        <div class="grid sm:grid-cols-2 gap-4 mt-4">
            <div
                v-for="field in group.fields.filter(field => isSchemaFieldVisible(field, values))"
                :key="field.key"
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
