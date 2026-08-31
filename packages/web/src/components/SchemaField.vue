<script setup lang="ts">
import { computed } from "vue";
import UiField from "../ui/UiField.vue";
import UiInput from "../ui/UiInput.vue";
import UiNumberInput from "../ui/UiNumberInput.vue";
import UiSwitch from "../ui/UiSwitch.vue";
import UiSelect from "../ui/UiSelect.vue";
import UiTextarea from "../ui/UiTextarea.vue";
import EndpointListField from "./config/EndpointListField.vue";
import EventFilterField from "./config/EventFilterField.vue";
import ChoiceListField from "./config/ChoiceListField.vue";
import RecordListField from "./config/RecordListField.vue";
import type { SchemaFieldDef } from "./config/types.js";

interface Props {
    /** 字段定义（来自配置 Schema） */
    field: SchemaFieldDef;
    /** 禁用输入（如账号弹窗中未启用的协议分组） */
    disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    disabled: false,
});

const model = defineModel<unknown>();

type WidgetKind =
    | "input"
    | "number"
    | "switch"
    | "select"
    | "textarea"
    | "endpoint-list"
    | "event-filter"
    | "choice-list"
    | "record-list";

const widget = computed<WidgetKind>(() => {
    const rule = props.field.rule;
    if (rule.type === "array" && rule.ui?.widget === "endpoint-list") return "endpoint-list";
    if (rule.type === "array" && rule.ui?.widget === "choice-list") return "choice-list";
    if (rule.type === "array" && rule.ui?.widget === "record-list") return "record-list";
    if (rule.type === "object" && rule.ui?.widget === "event-filter") return "event-filter";
    if (rule.choices && rule.choices.length > 0) return "select";
    if (rule.type === "string") return "input";
    if (rule.type === "number") return "number";
    if (rule.type === "boolean") return "switch";
    if (rule.type === "object" || rule.type === "array") return "textarea";
    return "input";
});

const choiceOptions = computed(() =>
    (props.field.rule.choices || []).map(c => ({
        label: c.label,
        value: c.value,
    })),
);

const stringModel = computed<string>({
    get: () => (typeof model.value === "string" ? model.value : ""),
    set: value => {
        model.value = value;
    },
});

const numberModel = computed<number | undefined>({
    get: () => (typeof model.value === "number" ? model.value : undefined),
    set: value => {
        model.value = value;
    },
});

const booleanModel = computed<boolean>({
    get: () => model.value === true,
    set: value => {
        model.value = value;
    },
});

const choiceModel = computed<string | number | boolean | undefined>({
    get: () => {
        const value = model.value;
        return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? value
            : undefined;
    },
    set: value => {
        model.value = value;
    },
});
</script>

<template>
    <UiField :label="field.label" :required="field.rule.required" :hint="field.rule.description">
        <UiInput
            v-if="widget === 'input'"
            v-model="stringModel"
            :type="field.rule.sensitive ? 'password' : 'text'"
            :autocomplete="field.rule.sensitive ? 'off' : undefined"
            :placeholder="field.placeholder"
            :disabled="disabled" />
        <UiNumberInput
            v-else-if="widget === 'number'"
            v-model="numberModel"
            :min="field.rule.min"
            :max="field.rule.max"
            :disabled="disabled" />
        <UiSwitch v-else-if="widget === 'switch'" v-model="booleanModel" :disabled="disabled" />
        <UiSelect
            v-else-if="widget === 'select'"
            v-model="choiceModel"
            :options="choiceOptions"
            :placeholder="field.placeholder || '请选择'"
            :disabled="disabled" />
        <EndpointListField
            v-else-if="widget === 'endpoint-list'"
            v-model="model"
            :rule="field.rule"
            :disabled="disabled" />
        <EventFilterField
            v-else-if="widget === 'event-filter'"
            v-model="model"
            :rule="field.rule"
            :disabled="disabled" />
        <ChoiceListField
            v-else-if="widget === 'choice-list'"
            v-model="model"
            :rule="field.rule"
            :disabled="disabled" />
        <RecordListField
            v-else-if="widget === 'record-list'"
            v-model="model"
            :rule="field.rule"
            :disabled="disabled" />
        <UiTextarea
            v-else
            v-model="stringModel"
            mono
            :rows="4"
            :placeholder="field.placeholder || '请输入 JSON'"
            :disabled="disabled" />
    </UiField>
</template>
