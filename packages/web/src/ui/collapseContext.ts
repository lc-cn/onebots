import type { InjectionKey, Ref } from 'vue';

export interface CollapseContext {
    /** 当前激活项 name 数组（只读引用） */
    activeNames: Ref<string[]>;
    /** 切换某项展开/收起 */
    toggle: (name: string) => void;
}

export const collapseContextKey: InjectionKey<CollapseContext> = Symbol('UiCollapse');
