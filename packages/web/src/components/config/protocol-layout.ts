import type { SchemaFieldDef, SchemaGroup } from "./types";

export type ProtocolSectionKey = "transport" | "delivery" | "credentials" | "filter";

export interface ProtocolFieldSection {
    key: ProtocolSectionKey;
    title?: string;
    description?: string;
    columns: boolean;
    fields: SchemaFieldDef[];
}

export interface ProtocolFieldLayout {
    sections: ProtocolFieldSection[];
    advanced: SchemaFieldDef[];
}

const sectionDefinitions: Omit<ProtocolFieldSection, "fields">[] = [
    {
        key: "transport",
        title: "服务入口",
        description: "选择需要对外提供的正向连接方式",
        columns: true,
    },
    {
        key: "delivery",
        title: "事件推送",
        description: "Webhook 与反向 WebSocket 可分别添加多个目标",
        columns: false,
    },
    { key: "credentials", title: "身份与鉴权", columns: true },
    { key: "filter", columns: false },
];

const isKnownSection = (section: string): section is ProtocolSectionKey =>
    sectionDefinitions.some(definition => definition.key === section);

/** 将协议字段按 Schema 声明的语义分区整理成可直接渲染的布局。 */
export const buildProtocolFieldLayout = (group: SchemaGroup): ProtocolFieldLayout => {
    const fieldsBySection = new Map<ProtocolSectionKey, SchemaFieldDef[]>();
    sectionDefinitions.forEach(section => fieldsBySection.set(section.key, []));
    const advanced: SchemaFieldDef[] = [];

    for (const field of group.fields) {
        const section = field.rule.ui?.section;
        if (section && isKnownSection(section)) {
            fieldsBySection.get(section)?.push(field);
        } else {
            advanced.push(field);
        }
    }

    return {
        sections: sectionDefinitions
            .map(section => ({ ...section, fields: fieldsBySection.get(section.key) ?? [] }))
            .filter(section => section.fields.length > 0),
        advanced,
    };
};
