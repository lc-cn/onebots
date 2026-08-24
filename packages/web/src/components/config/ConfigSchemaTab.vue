<script setup lang="ts">
import type { SchemaGroup } from './types';
import SchemaField from '../SchemaField.vue';
import UiCollapse from '../../ui/UiCollapse.vue';
import UiCollapseItem from '../../ui/UiCollapseItem.vue';
import UiEmpty from '../../ui/UiEmpty.vue';

defineProps<{
    schemaGroups: SchemaGroup[];
    formModel: Record<string, unknown>;
}>();

const activeGroups = defineModel<string[]>('activeGroups', { required: true });
</script>

<template>
    <div class="pt-4">
        <UiCollapse v-if="schemaGroups.length" v-model="activeGroups">
            <UiCollapseItem
                v-for="group in schemaGroups"
                :key="group.key"
                :name="group.key"
                :title="group.title">
                <div class="flex flex-col gap-4">
                    <SchemaField
                        v-for="field in group.fields"
                        :key="field.key"
                        v-model="formModel[field.key]"
                        :field="field" />
                </div>
            </UiCollapseItem>
        </UiCollapse>
        <UiEmpty v-else title="未获取到配置 Schema" />
    </div>
</template>
