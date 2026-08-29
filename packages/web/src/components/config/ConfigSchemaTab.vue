<script setup lang="ts">
import type { SchemaGroup } from "./types";
import SchemaField from "../SchemaField.vue";
import UiCollapse from "../../ui/UiCollapse.vue";
import UiCollapseItem from "../../ui/UiCollapseItem.vue";
import UiEmpty from "../../ui/UiEmpty.vue";

defineProps<{
    schemaGroups: SchemaGroup[];
    formModel: Record<string, unknown>;
}>();

const activeGroups = defineModel<string[]>("activeGroups", { required: true });

const isWideField = (field: SchemaGroup["fields"][number]) =>
    field.rule.ui?.widget === "endpoint-list" ||
    field.rule.ui?.widget === "event-filter" ||
    field.rule.ui?.widget === "choice-list";
</script>

<template>
    <div class="pt-4">
        <UiCollapse v-if="schemaGroups.length" v-model="activeGroups">
            <UiCollapseItem
                v-for="group in schemaGroups"
                :key="group.key"
                :name="group.key"
                :title="group.title">
                <template #title>
                    <div class="min-w-0">
                        <div class="font-medium text-fg">{{ group.title }}</div>
                        <div
                            v-if="group.description"
                            class="mt-0.5 text-xs font-normal text-fg-tertiary">
                            {{ group.description }}
                        </div>
                    </div>
                </template>
                <div class="grid gap-4 sm:grid-cols-2">
                    <SchemaField
                        v-for="field in group.fields"
                        :key="field.key"
                        v-model="formModel[field.key]"
                        :field="field"
                        :class="isWideField(field) ? 'sm:col-span-2' : ''" />
                </div>
            </UiCollapseItem>
        </UiCollapse>
        <UiEmpty v-else title="未获取到配置 Schema" />
    </div>
</template>
