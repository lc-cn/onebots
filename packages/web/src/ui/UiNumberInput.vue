<script setup lang="ts">
import { IconMinus, IconPlus } from '@tabler/icons-vue';

interface Props {
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    min: undefined,
    max: undefined,
    step: 1,
    disabled: false
});

const model = defineModel<number | undefined>({ default: undefined });

function clamp(value: number): number {
    let result = value;
    if (props.min !== undefined) result = Math.max(props.min, result);
    if (props.max !== undefined) result = Math.min(props.max, result);
    return result;
}

function stepBy(direction: 1 | -1) {
    if (props.disabled) return;
    const base = model.value ?? props.min ?? 0;
    model.value = clamp(base + direction * props.step);
}

function onInput(event: Event) {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') {
        model.value = undefined;
        return;
    }
    const value = Number(raw);
    if (!Number.isNaN(value)) model.value = value;
}

function onBlur(event: Event) {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') {
        model.value = undefined;
        return;
    }
    const value = Number(raw);
    if (Number.isNaN(value)) {
        model.value = undefined;
        return;
    }
    model.value = clamp(value);
}
</script>

<template>
    <div class="relative flex items-center">
        <input
            :value="model"
            type="number"
            :min="min"
            :max="max"
            :step="step"
            :disabled="disabled"
            class="ui-number-input h-9 w-full rounded-control border border-border bg-surface px-3 pr-14 text-sm text-fg transition-opacity focus:border-accent focus:shadow-[0_0_0_3px_var(--ring)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            @input="onInput"
            @blur="onBlur" />
        <div class="absolute right-1 flex items-center gap-0.5">
            <button
                type="button"
                tabindex="-1"
                aria-label="减少"
                :disabled="disabled"
                class="flex h-6 w-6 items-center justify-center rounded text-fg-tertiary transition-opacity hover:bg-surface-raised hover:text-fg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                @click="stepBy(-1)">
                <IconMinus :size="14" />
            </button>
            <button
                type="button"
                tabindex="-1"
                aria-label="增加"
                :disabled="disabled"
                class="flex h-6 w-6 items-center justify-center rounded text-fg-tertiary transition-opacity hover:bg-surface-raised hover:text-fg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                @click="stepBy(1)">
                <IconPlus :size="14" />
            </button>
        </div>
    </div>
</template>

<style scoped>
/* 隐藏原生 spin 按钮 */
.ui-number-input::-webkit-outer-spin-button,
.ui-number-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
.ui-number-input {
    -moz-appearance: textfield;
    appearance: textfield;
}
</style>
