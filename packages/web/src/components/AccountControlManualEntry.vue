<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{ targetLabel: string; modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string]; submit: [] }>();
const dialog = ref<HTMLDialogElement>();
const trigger = ref<HTMLButtonElement>();
const desktopInput = ref<HTMLInputElement>();
const mobileInput = ref<HTMLInputElement>();
const error = ref("");
let mobileQuery: MediaQueryList | undefined;

function close() {
    if (dialog.value?.open) dialog.value.close();
}

function submit(source: "desktop" | "mobile") {
    if (!props.modelValue.trim()) {
        error.value = "请输入有效的目标 ID。";
        (source === "mobile" ? mobileInput : desktopInput).value?.focus();
        return;
    }
    close();
    emit("submit");
}

function update(event: Event) {
    error.value = "";
    emit("update:modelValue", (event.target as HTMLInputElement).value);
}

function onClose() {
    if (trigger.value?.isConnected && trigger.value.offsetParent !== null) trigger.value.focus();
}

onMounted(() => {
    mobileQuery = matchMedia("(max-width: 700px)");
    mobileQuery.addEventListener("change", close);
});
onBeforeUnmount(() => {
    mobileQuery?.removeEventListener("change", close);
    close();
});
</script>

<template>
    <form class="account-control-manual" @submit.prevent="submit('desktop')">
        <label for="control-manual-id">按 {{ targetLabel }} 打开</label>
        <div>
            <input
                id="control-manual-id"
                ref="desktopInput"
                :value="modelValue"
                maxlength="512"
                name="target-id"
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="Boolean(error)"
                :aria-describedby="error ? 'control-manual-id-error' : undefined"
                :placeholder="`输入${targetLabel}…`"
                @input="update" />
            <UiButton size="sm" type="submit">打开</UiButton>
        </div>
        <p v-if="error" id="control-manual-id-error" class="account-control-error" role="alert">
            {{ error }}
        </p>
    </form>
    <button
        ref="trigger"
        type="button"
        class="account-control-manual-trigger"
        aria-haspopup="dialog"
        aria-controls="account-control-manual-dialog"
        @click="dialog?.showModal()">
        按 {{ targetLabel }} 打开会话
    </button>
    <dialog
        id="account-control-manual-dialog"
        ref="dialog"
        class="account-control-manual-dialog"
        :aria-label="`按 ${targetLabel} 打开会话`"
        @click.self="close"
        @close="onClose">
        <form class="account-control-manual-sheet" @submit.prevent="submit('mobile')">
            <div class="account-control-manual-sheet-head">
                <strong>按 {{ targetLabel }} 打开会话</strong>
                <button type="button" @click="close">关闭</button>
            </div>
            <label for="control-manual-mobile-id">{{ targetLabel }}</label>
            <input
                id="control-manual-mobile-id"
                ref="mobileInput"
                :value="modelValue"
                maxlength="512"
                name="target-id"
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="Boolean(error)"
                :aria-describedby="error ? 'control-manual-mobile-id-error' : undefined"
                :placeholder="`输入${targetLabel}…`"
                @input="update" />
            <p
                v-if="error"
                id="control-manual-mobile-id-error"
                class="account-control-error"
                role="alert">
                {{ error }}
            </p>
            <UiButton type="submit" variant="primary"> 打开会话 </UiButton>
        </form>
    </dialog>
</template>
