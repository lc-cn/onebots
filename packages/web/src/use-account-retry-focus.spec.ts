import { nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useAccountRetryFocus } from "./use-account-retry-focus.js";

describe("控制页详情重试焦点", () => {
    it("错误清除但仍在加载时不移动焦点，成功结束后才聚焦结果", async () => {
        const error = ref("读取失败");
        const loading = ref(false);
        const focus = vi.fn();
        const result = ref({ focus } as unknown as HTMLElement);
        const retry = useAccountRetryFocus(error, loading, result);

        retry.begin();
        loading.value = true;
        error.value = "";
        await nextTick();
        expect(focus).not.toHaveBeenCalled();

        loading.value = false;
        await nextTick();
        await nextTick();
        expect(focus).toHaveBeenCalledOnce();
    });

    it("重试失败或切换会话时不抢走焦点", async () => {
        const error = ref("读取失败");
        const loading = ref(false);
        const focus = vi.fn();
        const result = ref({ focus } as unknown as HTMLElement);
        const retry = useAccountRetryFocus(error, loading, result);

        retry.begin();
        loading.value = true;
        await nextTick();
        loading.value = false;
        await nextTick();
        expect(focus).not.toHaveBeenCalled();

        retry.begin();
        loading.value = true;
        await nextTick();
        retry.reset();
        error.value = "";
        loading.value = false;
        await nextTick();
        expect(focus).not.toHaveBeenCalled();
    });
});
