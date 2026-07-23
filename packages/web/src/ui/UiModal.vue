<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from "vue";
import { IconX } from "@tabler/icons-vue";

interface Props {
    title?: string;
    width?: string;
}

const props = withDefaults(defineProps<Props>(), {
    width: "480px",
});

const visible = defineModel<boolean>({ default: false });

const panelRef = ref<HTMLElement | null>(null);
let lastFocused: HTMLElement | null = null;
let scrollLocked = false;

function lockScroll() {
    if (scrollLocked) return;
    document.body.style.overflow = "hidden";
    scrollLocked = true;
}

function unlockScroll() {
    if (!scrollLocked) return;
    document.body.style.overflow = "";
    scrollLocked = false;
}

function close() {
    visible.value = false;
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
        event.stopPropagation();
        close();
    }
}

watch(visible, async value => {
    if (value) {
        lastFocused = document.activeElement as HTMLElement | null;
        lockScroll();
        await nextTick();
        panelRef.value?.focus();
        document.addEventListener("keydown", onKeydown);
    } else {
        unlockScroll();
        document.removeEventListener("keydown", onKeydown);
        lastFocused?.focus();
        lastFocused = null;
    }
});

onUnmounted(() => {
    unlockScroll();
    document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
    <Teleport to="body">
        <Transition
            enter-active-class="transition-opacity duration-150 ease-out"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition-opacity duration-150 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0">
            <div
                v-if="visible"
                class="fixed inset-0 z-[90] bg-black/50"
                aria-hidden="true"
                @click="close"></div>
        </Transition>
        <Transition
            enter-active-class="transition duration-150 ease-out"
            enter-from-class="scale-[0.96] opacity-0"
            enter-to-class="scale-100 opacity-100"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="scale-100 opacity-100"
            leave-to-class="scale-[0.96] opacity-0">
            <div
                v-if="visible"
                ref="panelRef"
                role="dialog"
                aria-modal="true"
                tabindex="-1"
                class="fixed inset-0 z-[91] m-auto flex h-full w-full flex-col bg-surface focus:outline-none sm:h-fit sm:max-h-[85vh] sm:w-[var(--modal-width)] sm:max-w-[calc(100vw-2rem)] sm:rounded-card sm:border sm:border-border sm:shadow-xl"
                :style="{ '--modal-width': props.width }">
                <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
                    <h2 class="truncate text-base font-medium text-fg">{{ props.title }}</h2>
                    <button
                        type="button"
                        aria-label="关闭"
                        class="rounded-control p-1 text-fg-tertiary transition-colors hover:bg-surface-raised hover:text-fg"
                        @click="close">
                        <IconX :size="18" />
                    </button>
                </div>
                <div class="min-h-0 flex-1 overflow-y-auto p-4">
                    <slot />
                </div>
                <div
                    v-if="$slots.footer"
                    class="flex shrink-0 justify-end gap-2 border-t border-border p-3">
                    <slot name="footer" />
                </div>
            </div>
        </Transition>
    </Teleport>
</template>
