<script setup lang="ts">
import { computed } from 'vue';
import UiField from '../ui/UiField.vue';
import UiInput from '../ui/UiInput.vue';
import UiNumberInput from '../ui/UiNumberInput.vue';
import UiSwitch from '../ui/UiSwitch.vue';
import UiSelect from '../ui/UiSelect.vue';
import UiTextarea from '../ui/UiTextarea.vue';

interface SchemaFieldRule {
    required?: boolean;
    type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
    min?: number;
    max?: number;
    enum?: unknown[];
    description?: string;
    placeholder?: string;
}

interface SchemaFieldDef {
    key: string;
    label: string;
    rule: SchemaFieldRule;
    placeholder: string;
}

interface Props {
    /** 字段定义（来自配置 Schema） */
    field: SchemaFieldDef;
    /** 禁用输入（如账号弹窗中未启用的协议分组） */
    disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    disabled: false
});

const model = defineModel<unknown>();

type WidgetKind = 'input' | 'number' | 'switch' | 'select' | 'textarea';

const widget = computed<WidgetKind>(() => {
    const rule = props.field.rule;
    if (rule.type === 'string' && !rule.enum) return 'input';
    if (rule.type === 'number') return 'number';
    if (rule.type === 'boolean') return 'switch';
    if (rule.enum) return 'select';
    if (rule.type === 'object' || rule.type === 'array') return 'textarea';
    return 'input';
});

const enumOptions = computed(() =>
    (props.field.rule.enum || []).map(value => ({
        label: String(value),
        value: value as string | number | boolean
    }))
);

const stringModel = computed<string>({
    get: () => (typeof model.value === 'string' ? model.value : ''),
    set: value => {
        model.value = value;
    }
});

const numberModel = computed<number | undefined>({
    get: () => (typeof model.value === 'number' ? model.value : undefined),
    set: value => {
        model.value = value;
    }
});

const booleanModel = computed<boolean>({
    get: () => model.value === true,
    set: value => {
        model.value = value;
    }
});

const enumModel = computed<string | number | boolean | undefined>({
    get: () => {
        const value = model.value;
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? value
            : undefined;
    },
    set: value => {
        model.value = value;
    }
});
</script>

<template>
    <UiField :label="field.label" :required="field.rule.required" :hint="field.rule.description">
        <UiInput
            v-if="widget === 'input'"
            v-model="stringModel"
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
            v-model="enumModel"
            :options="enumOptions"
            :placeholder="field.placeholder || '请选择'"
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
