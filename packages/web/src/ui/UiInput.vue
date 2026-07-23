<script setup lang="ts">
import { computed, ref } from 'vue';
import { IconEye, IconEyeOff, IconX } from '@tabler/icons-vue';

interface Props {
    type?: 'text' | 'password';
    placeholder?: string;
    disabled?: boolean;
    clearable?: boolean;
    maxlength?: number;
    error?: string;
    autocomplete?: string;
}

const props = withDefaults(defineProps<Props>(), {
    type: 'text',
    placeholder: '',
    disabled: false,
    clearable: false,
    maxlength: undefined,
    error: '',
    autocomplete: undefined
});

const model = defineModel<string>({ default: '' });

const showPassword = ref(false);

const inputType = computed(() => {
    if (props.type === 'password') return showPassword.value ? 'text' : 'password';
    return 'text';
});

const showClear = computed(() => props.clearable && !props.disabled && model.value.length > 0);
const showToggle = computed(() => props.type === 'password');

function clear() {
    model.value = '';
}
</script>

<template>
    <div class="relative flex items-center">
        <input
            v-model="model"
            :type="inputType"
            :placeholder="placeholder"
            :disabled="disabled"
            :maxlength="maxlength"
            :autocomplete="autocomplete"
            :aria-invalid="!!error || undefined"
            class="h-9 w-full rounded-control border bg-surface px-3 text-sm text-fg placeholder:text-fg-tertiary transition-opacity focus:shadow-[0_0_0_3px_var(--ring)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            :class="[
                error ? 'border-danger focus:border-danger' : 'border-border focus:border-accent',
                showClear || showToggle ? 'pr-9' : ''
            ]" />
        <div
            v-if="showClear || showToggle"
            class="absolute right-2 flex items-center gap-1 text-fg-tertiary">
            <button
                v-if="showClear"
                type="button"
                tabindex="-1"
                aria-label="清空"
                class="transition-opacity hover:text-fg-secondary"
                @click="clear">
                <IconX :size="14" />
            </button>
            <button
                v-if="showToggle"
                type="button"
                tabindex="-1"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                class="transition-opacity hover:text-fg-secondary"
                @click="showPassword = !showPassword">
                <IconEyeOff v-if="showPassword" :size="16" />
                <IconEye v-else :size="16" />
            </button>
        </div>
    </div>
</template>
