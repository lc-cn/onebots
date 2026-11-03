import type { AdmissionInspection } from "../workspace-admission/types.js";

const escapeHtml = (value: string): string =>
    value.replace(
        /[&<>"']/g,
        character =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
    );

/** 拒绝态无凭据/业务请求，不加载仍会展示配对表单的正常管理 SPA。 */
export function admissionMaintenancePage(inspection: AdmissionInspection): string {
    const instructions: Record<AdmissionInspection["state"], string> = {
        verified: "工作区来源已确认。",
        unbound:
            "请先停止管理服务，在本机生成首次登记计划，核对旧管理会话失效的影响后明确登记。登记完成并重新启动后，再进行设备配对。",
        "authority-unavailable":
            "请检查原卷外 authority 的持久挂载和访问能力。缺失或损坏的登记簿不能自动补建，请保留原数据并恢复匹配的原备份。",
        "binding-mismatch":
            "当前目录与原登记不匹配，可能是副本。请确认挂载的是原数据卷及其卷外 authority；首期不支持复制 .control 后强制接管。",
        "registration-pending":
            "首次登记尚未完成。请停止管理服务，在本机查看原请求，并使用原 requestId 显式续办；不要重新生成身份。",
        unsupported:
            "当前环境或旧安装的退出证据不足。请保留数据，通过本机诊断确认受支持的恢复方式。",
    };
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>OneBots · 工作区需要确认</title>
<style>html{color-scheme:light dark;font:16px/1.7 system-ui,sans-serif}body{margin:0;padding:8vh 24px}main{max-width:680px;margin:auto}h1{font-size:1.8rem;line-height:1.3}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;padding:16px;border:1px solid #8886;border-radius:8px}small{opacity:.7}</style></head><body><main>
<small>OneBots 管理服务 · 只读诊断</small><h1>工作区暂未取得运行权</h1>
<p>${escapeHtml(instructions[inspection.state])}</p>
<p>当前未开放账号、配置、日志、终端和配对操作。请勿删除证明文件、修改历史 PID，或用旧程序绕过检查。</p>
<pre>onebots workspace inspect --data-dir &lt;工作区&gt; --authority-dir &lt;卷外目录&gt;
onebots doctor --data-dir &lt;工作区&gt; --authority-dir &lt;卷外目录&gt;</pre>
<p>仅首次登记使用 <code>workspace plan</code> / <code>workspace register</code>；未完成事务使用 <code>workspace resume</code>。这些操作须在本机执行。</p>
<small>诊断：${escapeHtml(inspection.state)} / ${escapeHtml(inspection.reason)}</small>
</main></body></html>`;
}
