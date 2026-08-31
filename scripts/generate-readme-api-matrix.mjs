import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { PROTOCOL_API_CAPABILITY_MAP } from "./protocol-api-capability-map.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const readmePath = process.env.ONEBOTS_README_PATH
    ? path.resolve(process.env.ONEBOTS_README_PATH)
    : path.join(repositoryRoot, "README.md");
const catalogPath = process.env.ONEBOTS_CAPABILITY_CATALOG_PATH
    ? path.resolve(process.env.ONEBOTS_CAPABILITY_CATALOG_PATH)
    : path.join(repositoryRoot, "packages/onebots/src/extension-capability-catalog.json");
const startMarker = "<!-- protocol-api-matrix:start -->";
const endMarker = "<!-- protocol-api-matrix:end -->";

const platformLabels = {
    dingtalk: "钉钉",
    discord: "Discord",
    email: "邮件",
    feishu: "飞书",
    "google-chat": "Google Chat",
    heychat: "黑盒",
    icqq: "ICQQ",
    kook: "KOOK",
    line: "LINE",
    matrix: "Matrix",
    qq: "QQ",
    slack: "Slack",
    teams: "Teams",
    telegram: "TG",
    wechat: "微信",
    "wechat-clawbot": "ClawBot",
    wecom: "企微",
    "wecom-kf": "企微客服",
    whatsapp: "WA",
    zulip: "Zulip",
};

function readSource(relativePath) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    return ts.createSourceFile(
        absolutePath,
        fs.readFileSync(absolutePath, "utf8"),
        ts.ScriptTarget.Latest,
        true,
    );
}

function propertyName(property, source) {
    if (!property.name) return null;
    if (ts.isIdentifier(property.name)) return property.name.text;
    if (ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) {
        return property.name.text;
    }
    return property.name.getText(source).replace(/^['"]|['"]$/g, "");
}

function findVariable(source, name) {
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
                return declaration.initializer;
            }
        }
    }
    throw new Error(`未找到动作声明 ${name}`);
}

function stringArray(initializer) {
    while (
        initializer &&
        (ts.isAsExpression(initializer) ||
            ts.isSatisfiesExpression(initializer) ||
            ts.isParenthesizedExpression(initializer))
    ) {
        initializer = initializer.expression;
    }
    const array =
        initializer && ts.isNewExpression(initializer) ? initializer.arguments?.[0] : initializer;
    if (!array || !ts.isArrayLiteralExpression(array)) {
        throw new Error("动作声明必须是字符串数组或 new Set(字符串数组)");
    }
    return array.elements
        .filter(
            element => ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element),
        )
        .map(element => element.text);
}

function objectKeys(initializer, source) {
    if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
        throw new Error("动作声明必须是对象字面量");
    }
    return initializer.properties
        .filter(property => ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property))
        .map(property => propertyName(property, source))
        .filter(Boolean);
}

function functionReturnKeys(relativePath, functionName) {
    const source = readSource(relativePath);
    const declaration = source.statements.find(
        statement => ts.isFunctionDeclaration(statement) && statement.name?.text === functionName,
    );
    if (!declaration?.body) throw new Error(`未找到动作工厂 ${functionName}`);
    const returnStatement = declaration.body.statements.find(ts.isReturnStatement);
    return objectKeys(returnStatement?.expression, source);
}

function switchCases(relativePath, className, methodName) {
    const source = readSource(relativePath);
    const classDeclaration = source.statements.find(
        statement => ts.isClassDeclaration(statement) && statement.name?.text === className,
    );
    const method = classDeclaration?.members.find(
        member =>
            ts.isMethodDeclaration(member) &&
            member.name &&
            propertyName(member, source) === methodName,
    );
    if (!method?.body) throw new Error(`未找到动作分派器 ${className}.${methodName}`);
    const actions = [];
    function visit(node) {
        if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) {
            actions.push(node.expression.text);
        }
        ts.forEachChild(node, visit);
    }
    visit(method.body);
    return actions;
}

function declaredProtocolActions() {
    const oneBotV11 = [
        ...functionReturnKeys(
            "protocols/onebot-v11/protocol/src/actions/messages.ts",
            "createMessageActions",
        ),
        ...functionReturnKeys(
            "protocols/onebot-v11/protocol/src/actions/groups.ts",
            "createGroupActions",
        ),
        ...functionReturnKeys(
            "protocols/onebot-v11/protocol/src/actions/info.ts",
            "createInfoActions",
        ),
    ];

    const oneBotV12Source = readSource("protocols/onebot-v12/protocol/src/supported-actions.ts");
    const oneBotV12 = [
        ...stringArray(findVariable(oneBotV12Source, "PROTOCOL_BUILTIN_ACTIONS")),
        ...objectKeys(
            findVariable(oneBotV12Source, "STANDARD_ACTION_REQUIREMENTS"),
            oneBotV12Source,
        ),
    ];

    const satoriV1 = switchCases(
        "protocols/satori-v1/protocol/src/actions.ts",
        "SatoriActionService",
        "execute",
    );

    const milkyDeclarations = [
        ["account-actions.ts", "MILKY_ACCOUNT_ACTIONS"],
        ["group-actions.ts", "MILKY_GROUP_ACTIONS"],
        ["group-requests.ts", "MILKY_GROUP_REQUEST_ACTIONS"],
        ["friend-requests.ts", "MILKY_FRIEND_REQUEST_ACTIONS"],
        ["file-actions.ts", "MILKY_FILE_ACTIONS"],
        ["message-actions.ts", "MILKY_MESSAGE_ACTIONS"],
        ["directory-actions.ts", "MILKY_DIRECTORY_ACTIONS"],
    ];
    const milkyV1 = milkyDeclarations.flatMap(([file, name]) => {
        const source = readSource(`protocols/milky-v1/protocol/src/${file}`);
        return stringArray(findVariable(source, name));
    });
    milkyV1.push("get_friend_requests", "get_group_notifications");

    return {
        "onebot-v11": oneBotV11,
        "onebot-v12": oneBotV12,
        "satori-v1": satoriV1,
        "milky-v1": milkyV1,
    };
}

function assertMappingsCurrent() {
    const declared = declaredProtocolActions();
    for (const protocol of PROTOCOL_API_CAPABILITY_MAP) {
        const expected = [...new Set(declared[protocol.key])].sort();
        const actual = [...new Set(protocol.apis.map(entry => entry.api))].sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            const missing = expected.filter(action => !actual.includes(action));
            const stale = actual.filter(action => !expected.includes(action));
            throw new Error(
                `${protocol.title} API 映射已过期；缺少: ${missing.join(", ") || "无"}；多余: ${stale.join(", ") || "无"}`,
            );
        }
    }
}

function descriptorStatus(manifest, action) {
    const descriptor = manifest.actions[action];
    if (!descriptor || descriptor.support === "unsupported") return "unsupported";
    return descriptor.support;
}

function resolveStatus(manifest, requirement) {
    if (requirement === null) return "builtin";
    if (typeof requirement === "string") return descriptorStatus(manifest, requirement);
    const actions = requirement.anyOf ?? requirement.allOf;
    const statuses = actions.map(action => descriptorStatus(manifest, action));
    if (requirement.allOf) {
        if (statuses.includes("unsupported")) return "unsupported";
        if (statuses.includes("emulated")) return "emulated";
        return "native";
    }
    if (statuses.includes("native")) return "native";
    if (statuses.includes("emulated")) return "emulated";
    return "unsupported";
}

function statusSymbol(status) {
    if (status === "builtin") return "◆";
    if (status === "native") return "✅";
    if (status === "emulated") return "◐";
    return "—";
}

function renderMatrix(catalog) {
    const platforms = Object.keys(catalog.adapters);
    const sections = PROTOCOL_API_CAPABILITY_MAP.map((protocol, index) => {
        const header = ["API", ...platforms.map(platform => platformLabels[platform] ?? platform)];
        const separator = [":---", ...platforms.map(() => ":---:")];
        const rows = protocol.apis.map(entry => [
            `\`${entry.api}\``,
            ...platforms.map(platform =>
                statusSymbol(resolveStatus(catalog.adapters[platform].manifest, entry.requirement)),
            ),
        ]);
        const table = [header, separator, ...rows].map(row => `| ${row.join(" | ")} |`).join("\n");
        return [
            `<details${index === 0 ? " open" : ""}>`,
            `<summary><b>${protocol.title}（${protocol.apis.length} 个标准 API）</b></summary>`,
            "",
            table,
            "",
            "</details>",
        ].join("\n");
    });

    return [
        startMarker,
        "## 协议 API × 平台支持矩阵",
        "这里展示各协议标准 API 在不同平台适配器上的默认能力。`✅` 平台原生支持，`◐` 由 OneBots 组合或有损模拟，`◆` 由协议层直接提供，`—` 当前不支持。账号权限、套餐、事件订阅和会话上下文可能进一步限制实际可用性；平台原生扩展动作未列入此表。",
        "矩阵由协议动作目录和适配器能力清单自动生成，可运行 `pnpm readme:capabilities` 更新。",
        ...sections,
        endMarker,
    ].join("\n\n");
}

assertMappingsCurrent();
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const generated = renderMatrix(catalog);
const currentReadme = fs.readFileSync(readmePath, "utf8");
let nextReadme;
if (currentReadme.includes(startMarker) && currentReadme.includes(endMarker)) {
    const start = currentReadme.indexOf(startMarker);
    const end = currentReadme.indexOf(endMarker) + endMarker.length;
    nextReadme = currentReadme.slice(0, start) + generated + currentReadme.slice(end);
} else {
    const anchor = "## 五分钟上手";
    if (!currentReadme.includes(anchor)) throw new Error(`README 缺少插入锚点: ${anchor}`);
    nextReadme = currentReadme.replace(anchor, `${generated}\n\n---\n\n${anchor}`);
}

if (process.argv.includes("--check")) {
    if (nextReadme !== currentReadme) {
        console.error("README API 支持矩阵已过期，请运行 pnpm readme:capabilities");
        process.exitCode = 1;
    }
} else {
    fs.writeFileSync(readmePath, nextReadme);
    console.log("已更新 README API 支持矩阵");
}
