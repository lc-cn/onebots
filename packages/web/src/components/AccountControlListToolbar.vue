<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ControlAccountItem } from "@onebots/core/control";
import { IconChevronDown, IconRefresh } from "@tabler/icons-vue";
import type { AccountControlTab } from "../account-control-list.js";

const props = defineProps<{
    categories: ReadonlyArray<{ id: AccountControlTab; label: string }>;
    category: AccountControlTab;
    selectedGuild?: ControlAccountItem;
    loading: boolean;
}>();
const emit = defineEmits<{
    "update:category": [category: AccountControlTab];
    leaveGuild: [];
    refresh: [];
}>();
const categoryLabel = computed(
    () => props.categories.find(item => item.id === props.category)?.label ?? "会话",
);
const trigger = ref<HTMLButtonElement>();
const dialog = ref<HTMLDialogElement>();
let mobileQuery: MediaQueryList | undefined;

function close() {
    if (dialog.value?.open) dialog.value.close();
}

function select(category: AccountControlTab) {
    emit("update:category", category);
    close();
}

function onClose() {
    if (mobileQuery?.matches && trigger.value?.isConnected) trigger.value.focus();
}

onMounted(() => {
    mobileQuery = matchMedia("(max-width: 700px)");
    mobileQuery.addEventListener("change", close);
});
onBeforeUnmount(() => {
    mobileQuery?.removeEventListener("change", close);
    close();
});
watch(() => props.selectedGuild, close);
</script>

<template>
    <div class="account-control-category" role="group" aria-label="会话分类">
        <button
            v-for="item in categories"
            :key="item.id"
            type="button"
            :aria-pressed="category === item.id"
            :class="{ active: category === item.id }"
            @click="select(item.id)">
            {{ item.label }}
        </button>
        <button
            type="button"
            class="account-control-category-refresh"
            aria-label="刷新列表"
            :aria-disabled="loading"
            @click="emit('refresh')">
            <IconRefresh :size="17" aria-hidden="true" />
        </button>
    </div>
    <div class="account-control-list-head" :class="{ 'has-guild': selectedGuild }">
        <button
            v-if="selectedGuild"
            type="button"
            :aria-label="`返回 ${selectedGuild.name} 的服务器列表`"
            @click="emit('leaveGuild')">
            <span class="account-control-guild-name">← {{ selectedGuild.name }}</span>
        </button>
        <button
            ref="trigger"
            type="button"
            class="account-control-category-trigger"
            aria-haspopup="dialog"
            aria-controls="account-control-category-dialog"
            :aria-label="`切换会话分类，当前为${categoryLabel}`"
            @click="dialog?.showModal()">
            {{ categoryLabel }} <IconChevronDown :size="16" aria-hidden="true" />
        </button>
        <button
            type="button"
            class="account-control-list-refresh"
            aria-label="刷新列表"
            :aria-disabled="loading"
            @click="emit('refresh')">
            <IconRefresh :size="17" aria-hidden="true" />
        </button>
    </div>
    <dialog
        id="account-control-category-dialog"
        ref="dialog"
        class="account-control-category-dialog"
        aria-label="选择会话分类"
        @click.self="close"
        @close="onClose">
        <div class="account-control-category-sheet">
            <div class="account-control-category-sheet-head">
                <strong>选择会话分类</strong>
                <button type="button" @click="close">关闭</button>
            </div>
            <div class="account-control-category-options">
                <button
                    v-for="item in categories"
                    :key="item.id"
                    type="button"
                    :aria-current="category === item.id ? 'true' : undefined"
                    @click="select(item.id)">
                    {{ item.label }}
                    <span v-if="category === item.id">当前</span>
                </button>
            </div>
        </div>
    </dialog>
</template>
