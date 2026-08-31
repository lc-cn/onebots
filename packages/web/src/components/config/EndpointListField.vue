<script setup lang="ts">
import { computed, reactive } from "vue";
import { IconAdjustmentsHorizontal, IconLink, IconPlus, IconTrash } from "@tabler/icons-vue";
import UiButton from "../../ui/UiButton.vue";
import UiInput from "../../ui/UiInput.vue";
import UiNumberInput from "../../ui/UiNumberInput.vue";
import UiSwitch from "../../ui/UiSwitch.vue";
import type { ValidationRule } from "./types.js";

const props = withDefaults(
    defineProps<{
        rule: ValidationRule;
        disabled?: boolean;
    }>(),
    { disabled: false },
);

const model = defineModel<unknown>();
const advancedState = reactive(new Map<number, boolean>());

const entries = computed<unknown[]>(() => (Array.isArray(model.value) ? model.value : []));
const itemFields = computed(() => props.rule.ui?.fields ?? []);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const replaceEntries = (next: unknown[]) => {
    model.value = next;
};

const entryUrl = (entry: unknown) => {
    if (typeof entry === "string") return entry;
    return isRecord(entry) && typeof entry.url === "string" ? entry.url : "";
};

const updateUrl = (index: number, url: string) => {
    const next = [...entries.value];
    const current = next[index];
    next[index] = isRecord(current) ? { ...current, url } : url;
    replaceEntries(next);
};

const updateOption = (index: number, key: string, value: unknown) => {
    const next = [...entries.value];
    const current = next[index];
    const objectValue = isRecord(current) ? { ...current } : { url: entryUrl(current) };
    if (value === "" || value === undefined) delete objectValue[key];
    else objectValue[key] = value;
    next[index] = objectValue;
    replaceEntries(next);
};

const addEntry = () => {
    replaceEntries([...entries.value, ""]);
};

const removeEntry = (index: number) => {
    replaceEntries(entries.value.filter((_, itemIndex) => itemIndex !== index));
    advancedState.clear();
};

const toggleAdvanced = (index: number) => {
    advancedState.set(index, !isAdvanced(index, entries.value[index]));
};

const isAdvanced = (index: number, entry: unknown) => advancedState.get(index) ?? isRecord(entry);

const fieldValue = (entry: unknown, key: string) => (isRecord(entry) ? entry[key] : undefined);

const stringOption = (entry: unknown, key: string) => {
    const value = fieldValue(entry, key);
    return typeof value === "string" ? value : "";
};

const numberOption = (entry: unknown, key: string) => {
    const value = fieldValue(entry, key);
    return typeof value === "number" ? value : undefined;
};

const booleanOption = (entry: unknown, key: string) => fieldValue(entry, key) === true;

const urlError = (entry: unknown) => {
    const value = entryUrl(entry).trim();
    if (!value) return "";
    try {
        const url = new URL(value);
        const schemes = props.rule.ui?.schemes;
        if (schemes?.length && !schemes.includes(url.protocol)) {
            return `仅支持 ${schemes.map(item => item.replace(":", "")).join(" / ")}`;
        }
        return "";
    } catch {
        return "请输入完整 URL";
    }
};

const endpointPlaceholder = computed(() => {
    if (props.rule.placeholder) return props.rule.placeholder;
    const schemes = props.rule.ui?.schemes ?? [];
    return schemes.some(scheme => scheme === "ws:" || scheme === "wss:")
        ? "wss://events.example.com"
        : "https://example.com/webhook";
});
</script>

<template>
    <div class="space-y-2.5">
        <div
            v-if="entries.length === 0"
            class="flex items-center justify-between gap-4 rounded-card border border-dashed border-border-strong bg-surface-raised/45 px-4 py-3">
            <div class="flex min-w-0 items-center gap-3">
                <span
                    class="grid size-8 shrink-0 place-items-center rounded-control bg-surface text-fg-tertiary">
                    <IconLink :size="16" aria-hidden="true" />
                </span>
                <div class="min-w-0">
                    <p class="text-sm font-medium text-fg">尚未配置推送目标</p>
                    <p class="truncate text-xs text-fg-tertiary">
                        不配置时不会建立反向连接或发送事件
                    </p>
                </div>
            </div>
            <UiButton size="sm" :disabled="disabled" @click="addEntry">
                <IconPlus :size="14" aria-hidden="true" />
                {{ rule.ui?.addLabel ?? "添加地址" }}
            </UiButton>
        </div>

        <article
            v-for="(entry, index) in entries"
            :key="index"
            class="rounded-card bg-surface-raised/60 p-3">
            <div class="flex items-start gap-2">
                <span
                    class="mt-1.5 w-6 shrink-0 font-mono text-[11px] font-semibold tabular-nums text-fg-tertiary">
                    {{ String(index + 1).padStart(2, "0") }}
                </span>
                <div class="min-w-0 flex-1">
                    <UiInput
                        :model-value="entryUrl(entry)"
                        :error="urlError(entry)"
                        :placeholder="endpointPlaceholder"
                        :disabled="disabled"
                        @update:model-value="updateUrl(index, $event)" />
                    <p v-if="urlError(entry)" class="mt-1 text-xs text-danger">
                        {{ urlError(entry) }}
                    </p>
                </div>
                <button
                    v-if="itemFields.length"
                    type="button"
                    :disabled="disabled"
                    :aria-expanded="isAdvanced(index, entry)"
                    class="grid size-9 shrink-0 place-items-center rounded-control text-fg-tertiary transition-colors hover:bg-surface hover:text-fg disabled:opacity-50"
                    aria-label="高级设置"
                    @click="toggleAdvanced(index)">
                    <IconAdjustmentsHorizontal :size="16" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    :disabled="disabled"
                    class="grid size-9 shrink-0 place-items-center rounded-control text-fg-tertiary transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    aria-label="删除地址"
                    @click="removeEntry(index)">
                    <IconTrash :size="16" aria-hidden="true" />
                </button>
            </div>

            <div
                v-if="itemFields.length && isAdvanced(index, entry)"
                class="ml-8 mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                <label v-for="option in itemFields" :key="option.key" class="space-y-1.5">
                    <span class="text-xs font-medium text-fg-secondary">{{ option.label }}</span>
                    <UiNumberInput
                        v-if="option.type === 'number'"
                        :model-value="numberOption(entry, option.key)"
                        :disabled="disabled"
                        @update:model-value="updateOption(index, option.key, $event)" />
                    <UiSwitch
                        v-else-if="option.type === 'boolean'"
                        :model-value="booleanOption(entry, option.key)"
                        :disabled="disabled"
                        @update:model-value="updateOption(index, option.key, $event)" />
                    <UiInput
                        v-else
                        :model-value="stringOption(entry, option.key)"
                        :type="option.sensitive ? 'password' : 'text'"
                        :placeholder="option.placeholder"
                        :disabled="disabled"
                        @update:model-value="updateOption(index, option.key, $event)" />
                    <span v-if="option.description" class="block text-xs text-fg-tertiary">
                        {{ option.description }}
                    </span>
                </label>
            </div>
        </article>

        <UiButton v-if="entries.length" size="sm" :disabled="disabled" @click="addEntry">
            <IconPlus :size="14" aria-hidden="true" />
            {{ rule.ui?.addLabel ?? "添加地址" }}
        </UiButton>
    </div>
</template>
