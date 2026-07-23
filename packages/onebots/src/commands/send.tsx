import { argument, option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { sendMessage } from "../cli/command-application.js";
import { runtimeOptions } from "../cli/command-options.js";

export const description = "通过运行中的网关发送消息";
export const options = runtimeOptions.extend({
    target_type: z.enum(["private", "group", "channel"]).describe(option({ description: "目标类型", valueDescription: "type" })),
    channel: z.string().describe(option({ description: "发信 bot，格式 platform.account_id", valueDescription: "channel" })),
    url: z.string().optional().describe(option({ description: "网关 base URL", valueDescription: "baseUrl" })),
});
export const args = z.tuple([
    z.string().describe(argument({ name: "target_id" })),
    z.string().describe(argument({ name: "message" })),
]);

export default function SendCommand({ options: input, args: [targetId, message] }: { options: z.infer<typeof options>; args: z.infer<typeof args> }) {
    return <CommandRunner execute={() => sendMessage(input, targetId, message)} />;
}
