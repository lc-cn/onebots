<script setup lang='ts'>
import { ref } from 'vue';

interface TabItem {
    key: string;
    label: string;
}

interface Props {
    /** 页签列表 */
    tabs: TabItem[];
    /** 当前激活项 key */
    modelValue: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    'update:modelValue': [key: string];
}>();

const tabRefs = ref<HTMLButtonElement[]>([]);

function select(key: string) {
    if (key !== props.modelValue) {
        emit('update:modelValue', key);
    }
}

function onKeydown(event: KeyboardEvent, index: number) {
    let nextIndex = -1;
    if (event.key === 'ArrowRight') {
        nextIndex = (index + 1) % props.tabs.length;
    } else if (event.key === 'ArrowLeft') {
        nextIndex = (index - 1 + props.tabs.length) % props.tabs.length;
    }
    if (nextIndex >= 0) {
        event.preventDefault();
        const next = props.tabs[nextIndex];
        select(next.key);
        tabRefs.value[nextIndex]?.focus();
    }
}
</script>

<template>
    <div role="tablist" class="flex items-center gap-1 border-b border-border">
        <button
            v-for="(tab, index) in tabs"
            :key="tab.key"
            :ref="el => el && (tabRefs[index] = el as HTMLButtonElement)"
            type="button"
            role="tab"
            :aria-selected="tab.key === modelValue"
            :tabindex="tab.key === modelValue ? 0 : -1"
            class="relative -mb-px px-3 py-2 text-sm transition-colors duration-150"
            :class="
                tab.key === modelValue
                    ? 'font-medium text-fg after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent'
                    : 'text-fg-secondary hover:text-fg'
            "
            @click="select(tab.key)"
            @keydown="onKeydown($event, index)">
            {{ tab.label }}
        </button>
    </div>
</template>
