<script setup lang="ts">
import { IconEdit, IconTrash } from '@tabler/icons-vue';
import UiButton from '../../ui/UiButton.vue';
import UiEmpty from '../../ui/UiEmpty.vue';
import type { AccountRow } from './types';

defineProps<{
    accounts: AccountRow[];
    accountEmptyText: string;
}>();

const emit = defineEmits<{
    edit: [row: AccountRow];
    remove: [row: AccountRow];
}>();
</script>

<template>
    <div class="pt-4">
        <div class="overflow-x-auto rounded-card border border-border">
            <table v-if="accounts.length" class="w-full text-sm">
                <thead>
                    <tr class="border-b border-border text-left text-xs text-fg-tertiary">
                        <th class="w-40 px-3 py-2 font-medium">平台</th>
                        <th class="w-48 px-3 py-2 font-medium">账号ID</th>
                        <th class="px-3 py-2 font-medium">配置</th>
                        <th class="w-44 px-3 py-2 font-medium">操作</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="row in accounts"
                        :key="row.key"
                        class="border-b border-border transition-colors last:border-b-0 hover:bg-surface-raised">
                        <td class="px-3 py-2 text-fg">{{ row.platform }}</td>
                        <td class="px-3 py-2 font-mono text-[13px] text-fg">
                            {{ row.account_id }}
                        </td>
                        <td class="px-3 py-2">
                            <pre
                                class="m-0 max-w-md truncate font-mono text-xs text-fg-secondary"
                                >{{ row.preview }}</pre
                            >
                        </td>
                        <td class="px-3 py-2">
                            <div class="flex items-center gap-2">
                                <UiButton
                                    variant="secondary"
                                    size="sm"
                                    @click="emit('edit', row)">
                                    <IconEdit :size="14" aria-hidden="true" />
                                    编辑
                                </UiButton>
                                <UiButton
                                    variant="danger"
                                    size="sm"
                                    @click="emit('remove', row)">
                                    <IconTrash :size="14" aria-hidden="true" />
                                    删除
                                </UiButton>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
            <UiEmpty v-else :title="accountEmptyText" />
        </div>
    </div>
</template>
