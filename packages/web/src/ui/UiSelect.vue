<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { IconCheck, IconChevronDown } from '@tabler/icons-vue';

interface Option {
    label: string;
    value: string | number | boolean;
}

interface Props {
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    placeholder: '请选择',
    disabled: false
});

const model = defineModel<string | number | boolean | undefined>({ default: undefined });

const rootRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const highlightIndex = ref(-1);

const selectedOption = computed(() => props.options.find(option => option.value === model.value));

function open() {
    if (props.disabled || isOpen.value) return;
    isOpen.value = true;
    const index = props.options.findIndex(option => option.value === model.value);
    highlightIndex.value = index >= 0 ? index : props.options.length > 0 ? 0 : -1;
}

function close() {
    isOpen.value = false;
    highlightIndex.value = -1;
}

function toggle() {
    if (isOpen.value) {
        close();
    } else {
        open();
    }
}

function select(option: Option) {
    model.value = option.value;
    close();
}

function moveHighlight(direction: 1 | -1) {
    if (props.options.length === 0) return;
    const next =
        highlightIndex.value < 0
            ? direction === 1
                ? 0
                : props.options.length - 1
            : (highlightIndex.value + direction + props.options.length) % props.options.length;
    highlightIndex.value = next;
}

function onTriggerKeydown(event: KeyboardEvent) {
    if (props.disabled) return;
    if (!isOpen.value) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            event.preventDefault();
            open();
        }
        return;
    }
    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            moveHighlight(1);
            break;
        case 'ArrowUp':
            event.preventDefault();
            moveHighlight(-1);
            break;
        case 'Enter':
        case ' ':
            event.preventDefault();
            if (highlightIndex.value >= 0) select(props.options[highlightIndex.value]);
            break;
        case 'Escape':
            event.preventDefault();
            close();
            break;
    }
}

function onDocumentMousedown(event: MouseEvent) {
    if (!isOpen.value) return;
    if (rootRef.value && !rootRef.value.contains(event.target as Node)) close();
}

watch(isOpen, value => {
    if (value) {
        document.addEventListener('mousedown', onDocumentMousedown);
    } else {
        document.removeEventListener('mousedown', onDocumentMousedown);
    }
});

onUnmounted(() => {
    document.removeEventListener('mousedown', onDocumentMousedown);
});
</script>

<template>
    <div ref="rootRef" class="relative">
        <button
            type="button"
            role="combobox"
            :aria-expanded="isOpen"
            aria-haspopup="listbox"
            :disabled="disabled"
            class="flex h-9 w-full items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 text-sm transition-opacity focus:border-accent focus:shadow-[0_0_0_3px_var(--ring)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            :class="selectedOption ? 'text-fg' : 'text-fg-tertiary'"
            @click="toggle"
            @keydown="onTriggerKeydown">
            <span class="truncate">{{ selectedOption ? selectedOption.label : placeholder }}</span>
            <IconChevronDown
                :size="16"
                class="shrink-0 text-fg-tertiary transition-transform"
                :class="isOpen ? 'rotate-180' : ''" />
        </button>
        <div
            v-if="isOpen"
            role="listbox"
            class="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-control border border-border bg-surface py-1 shadow-lg">
            <div
                v-for="(option, index) in options"
                :key="String(option.value)"
                role="option"
                :aria-selected="option.value === model"
                class="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-surface-raised"
                :class="[
                    option.value === model ? 'text-accent' : 'text-fg',
                    index === highlightIndex ? 'bg-surface-raised' : ''
                ]"
                @click="select(option)"
                @mouseenter="highlightIndex = index">
                <span class="truncate">{{ option.label }}</span>
                <IconCheck v-if="option.value === model" :size="16" class="shrink-0" />
            </div>
            <div v-if="options.length === 0" class="px-3 py-2 text-sm text-fg-tertiary">
                暂无选项
            </div>
        </div>
    </div>
</template>
