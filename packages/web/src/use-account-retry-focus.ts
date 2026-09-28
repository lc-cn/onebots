import { nextTick, ref, watch, type Ref } from "vue";

/** 重试完成后才移动焦点；失败时保留当前入口，避免加载中跳到空结果。 */
export function useAccountRetryFocus(
    error: Ref<string>,
    loading: Ref<boolean>,
    result: Ref<HTMLElement | undefined>,
) {
    const retrying = ref(false);
    let generation = 0;

    watch([error, loading], async ([currentError, currentLoading]) => {
        if (!retrying.value || currentLoading) return;
        const currentGeneration = generation;
        retrying.value = false;
        if (currentError) return;
        await nextTick();
        if (currentGeneration === generation) result.value?.focus();
    });

    return {
        begin: () => {
            generation++;
            retrying.value = true;
        },
        reset: () => {
            generation++;
            retrying.value = false;
        },
    };
}
