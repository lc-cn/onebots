import * as path from "node:path";
import {
    SERVICE_NAME,
    renderWindowsScriptOptions,
    type ServiceSpec,
} from "./service-definition.js";

const WINDOWS_SERVICE_ID = SERVICE_NAME.replace(/[^\w]/gi, "").toLowerCase();

export interface WindowsSystemServiceFiles {
    definition: string;
    executable: string;
}

interface XmlElement {
    name: string;
    value: string;
}

/** node-windows 将 WinSW 文件固定写入入口脚本旁的 daemon 目录。 */
export function getWindowsSystemServiceFiles(spec: ServiceSpec): WindowsSystemServiceFiles {
    const directory = path.join(path.dirname(path.resolve(spec.binPath)), "daemon");
    return {
        definition: path.join(directory, `${WINDOWS_SERVICE_ID}.xml`),
        executable: path.join(directory, `${WINDOWS_SERVICE_ID}.exe`),
    };
}

/** 验证 WinSW 的完整扁平配置，拒绝启动参数、路径或策略中的任何漂移。 */
export function validateWindowsSystemServiceDefinition(
    xml: string,
    spec: ServiceSpec,
    stateDirectory: string,
    wrapperPath: string,
): boolean {
    const actual = parseFlatServiceXml(xml);
    if (!actual) return false;

    const scriptOptions = renderWindowsScriptOptions(spec);
    const expected: XmlElement[] = [
        { name: "id", value: `${WINDOWS_SERVICE_ID}.exe` },
        { name: "name", value: SERVICE_NAME },
        { name: "description", value: "OneBots Bridge Service" },
        { name: "executable", value: path.resolve(spec.nodePath) },
        { name: "argument", value: "--harmony" },
        { name: "argument", value: path.resolve(wrapperPath) },
        { name: "argument", value: "--file" },
        { name: "argument", value: path.resolve(spec.binPath) },
        { name: "argument", value: `--scriptoptions=${scriptOptions}` },
        { name: "argument", value: "--log" },
        { name: "argument", value: `${SERVICE_NAME} wrapper` },
        { name: "argument", value: "--grow" },
        { name: "argument", value: "0" },
        { name: "argument", value: "--wait" },
        { name: "argument", value: "5" },
        { name: "argument", value: "--maxrestarts" },
        { name: "argument", value: "-1" },
        { name: "argument", value: "--abortonerror" },
        { name: "argument", value: "n" },
        { name: "argument", value: "--stopparentfirst" },
        { name: "argument", value: "undefined" },
        { name: "logmode", value: "rotate" },
        { name: "logpath", value: stateDirectory },
        { name: "stoptimeout", value: "30sec" },
        { name: "workingdirectory", value: spec.workingDirectory },
    ];

    return (
        actual.length === expected.length &&
        actual.every(
            (element, index) =>
                element.name === expected[index]?.name && element.value === expected[index]?.value,
        )
    );
}

function parseFlatServiceXml(xml: string): XmlElement[] | null {
    const service = xml.match(/^\s*<service>\s*([\s\S]*?)\s*<\/service>\s*$/u);
    if (!service) return null;

    const body = service[1] ?? "";
    const elements: XmlElement[] = [];
    const pattern = /<([a-z]+)>([^<]*)<\/\1>/gu;
    let cursor = 0;
    for (const match of body.matchAll(pattern)) {
        if (body.slice(cursor, match.index).trim()) return null;
        const value = decodeXmlText(match[2] ?? "");
        if (value === null) return null;
        elements.push({ name: match[1] ?? "", value });
        cursor = (match.index ?? 0) + match[0].length;
    }
    if (body.slice(cursor).trim()) return null;
    return elements;
}

function decodeXmlText(value: string): string | null {
    if (/&(?!(?:amp|lt|gt|quot|apos);)/u.test(value)) return null;
    const entities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
    };
    return value.replace(/&(amp|lt|gt|quot|apos);/gu, (_, name: string) => entities[name] ?? "");
}
