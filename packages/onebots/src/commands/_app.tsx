/** OneBots Pastel 路由共享的交互式终端外壳。 */
import type { AppProps } from "pastel";
import { Box, Text, useStdout } from "ink";

type ShellAwareCommand = AppProps["Component"] & { useShell?: boolean };

/** 在 TTY 中提供一致的产品上下文，管道输出和前台 runtime 保持纯净。 */
export default function OneBotsCliApp({ Component, commandProps }: AppProps) {
    const { stdout } = useStdout();
    const plain = (Component as ShellAwareCommand).useShell === false || commandProps.options.json === true;
    if (!stdout.isTTY || plain) return <Component {...commandProps} />;
    return <Box flexDirection="column">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
            <Text bold>ONEBOTS</Text><Text dimColor>  BRIDGE CONTROL</Text>
        </Box>
        <Component {...commandProps} />
    </Box>;
}
