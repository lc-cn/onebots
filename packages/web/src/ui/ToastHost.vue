<script setup lang="ts">
import {
    IconAlertCircle,
    IconAlertTriangle,
    IconCircleCheck,
    IconInfoCircle,
    IconX,
} from "@tabler/icons-vue";
import { toasts, useToast, type ToastType } from "./toast";

const { remove } = useToast();

const icons: Record<ToastType, typeof IconCircleCheck> = {
    success: IconCircleCheck,
    error: IconAlertCircle,
    warning: IconAlertTriangle,
    info: IconInfoCircle,
};

const iconClass: Record<ToastType, string> = {
    success: "text-success",
    error: "text-danger",
    warning: "text-warning",
    info: "text-info",
};
</script>

<template>
    <Teleport to="body">
        <div class="pointer-events-none fixed top-4 right-4 z-[100] flex flex-col gap-2">
            <TransitionGroup
                enter-active-class="transition duration-150 ease-out"
                enter-from-class="translate-x-4 opacity-0"
                enter-to-class="translate-x-0 opacity-100"
                leave-active-class="transition duration-150 ease-in"
                leave-from-class="translate-x-0 opacity-100"
                leave-to-class="translate-x-4 opacity-0">
                <div
                    v-for="toast in toasts"
                    :key="toast.id"
                    role="status"
                    class="pointer-events-auto flex max-w-sm items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm text-fg shadow-lg">
                    <component
                        :is="icons[toast.type]"
                        :size="18"
                        class="shrink-0"
                        :class="iconClass[toast.type]" />
                    <span class="min-w-0 break-words">{{ toast.message }}</span>
                    <button
                        type="button"
                        aria-label="关闭"
                        class="ml-auto shrink-0 rounded-control p-0.5 text-fg-tertiary transition-colors hover:bg-surface-raised hover:text-fg"
                        @click="remove(toast.id)">
                        <IconX :size="14" />
                    </button>
                </div>
            </TransitionGroup>
        </div>
    </Teleport>
</template>
