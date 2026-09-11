<script setup lang="ts">
import { computed, ref, useAttrs } from "vue";
import { IconEye, IconEyeOff, IconX } from "@tabler/icons-vue";

defineOptions({ inheritAttrs: false });

interface Props {
    id?: string;
    type?: "text" | "password";
    placeholder?: string;
    disabled?: boolean;
    clearable?: boolean;
    maxlength?: number;
    error?: string;
    autocomplete?: string;
}

const props = withDefaults(defineProps<Props>(), {
    id: undefined,
    type: "text",
    placeholder: "",
    disabled: false,
    clearable: false,
    maxlength: undefined,
    error: "",
    autocomplete: undefined,
});

const model = defineModel<string>({ default: "" });
const attrs = useAttrs();

const showPassword = ref(false);

const inputType = computed(() => {
    if (props.type === "password") return showPassword.value ? "text" : "password";
    return "text";
});

const showClear = computed(() => props.clearable && !props.disabled && model.value.length > 0);
const showToggle = computed(() => props.type === "password");

function clear() {
    model.value = "";
}
</script>

<template>
    <div class="relative flex items-center">
        <input
            v-bind="attrs"
            :id="id"
            v-model="model"
            :type="inputType"
            :placeholder="placeholder"
            :disabled="disabled"
            :maxlength="maxlength"
            :autocomplete="autocomplete"
            :aria-invalid="!!error || undefined"
            class="ui-input h-9 w-full rounded-control border bg-surface px-3 text-sm text-fg placeholder:text-fg-tertiary transition-opacity focus-visible:shadow-[0_0_0_3px_var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
            :class="[
                error
                    ? 'border-danger focus-visible:border-danger'
                    : 'border-border focus-visible:border-accent',
                showClear && showToggle ? 'pr-16' : showClear || showToggle ? 'pr-10' : '',
            ]" />
        <div
            v-if="showClear || showToggle"
            class="absolute right-1 flex items-center text-fg-tertiary">
            <button
                v-if="showClear"
                type="button"
                aria-label="清空"
                class="grid h-7 w-7 place-items-center rounded-control transition-colors hover:bg-surface-raised hover:text-fg-secondary"
                @click="clear">
                <IconX :size="14" aria-hidden="true" />
            </button>
            <button
                v-if="showToggle"
                type="button"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                class="grid h-7 w-7 place-items-center rounded-control transition-colors hover:bg-surface-raised hover:text-fg-secondary"
                @click="showPassword = !showPassword">
                <IconEyeOff v-if="showPassword" :size="16" aria-hidden="true" />
                <IconEye v-else :size="16" aria-hidden="true" />
            </button>
        </div>
    </div>
</template>
