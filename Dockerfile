# OneBots 多平台机器人网关 - Docker 镜像
# 构建：docker build -t onebots .
# 运行：docker run -p 6727:6727 -v ./data:/data onebots
# 持久化：将配置、数据库与静态校验文件放在挂载卷 /data；配置 public_static_dir: static 时，将可信域名 txt 放入宿主 ./data/static（容器内 /data/static）

FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# 复制依赖声明、工作空间配置与所有子包继承的 TypeScript 根配置
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# 复制各工作空间（.dockerignore 已排除 node_modules/lib 等）
COPY packages ./packages
COPY adapters ./adapters
COPY protocols ./protocols
COPY docs ./docs
COPY development ./development

# .dockerignore 已排除 adapters/adapter-icqq，但 development 仍声明了该 workspace 依赖；
# 安装前从 package.json 去掉，否则 pnpm 会报 workspace 包找不到。
RUN node --input-type=module -e "import fs from 'node:fs'; const p='development/package.json'; const pkg=JSON.parse(fs.readFileSync(p,'utf8')); if (pkg.dependencies?.['@onebots/adapter-icqq']) { delete pkg.dependencies['@onebots/adapter-icqq']; fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n'); }"

# 安装依赖并构建（无 adapter-icqq，无需 GitHub Packages token；锁文件与镜像上下文可能不一致，故不用 --frozen-lockfile）
RUN pnpm install --no-frozen-lockfile
# 仅构建网关所需包（跳过 docs：VitePress 需 git，Alpine 镜像未安装且运行时不需要文档）
RUN pnpm build:packages && pnpm --filter='./protocols/*/*' --filter='./adapters/*' build

# 生产依赖（去掉 devDependencies 以减小镜像）
RUN pnpm prune --prod

# ---------- 运行阶段 ----------
FROM node:24-alpine

ENV COREPACK_HOME=/usr/local/share/corepack

RUN apk add --no-cache su-exec \
  && corepack enable \
  && corepack prepare pnpm@9.15.9 --activate \
  && chown -R node:node "$COREPACK_HOME" \
  && mkdir -p /data/static \
  && chown -R node:node /data
WORKDIR /app

# 从构建阶段复制产物
COPY --chown=node:node --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages ./packages
COPY --chown=node:node --from=builder /app/adapters ./adapters
COPY --chown=node:node --from=builder /app/protocols ./protocols
COPY --chown=node:node --from=builder /app/development ./development
COPY --chown=node:node scripts/docker-healthcheck.mjs ./scripts/docker-healthcheck.mjs
COPY --chown=node:node scripts/docker-extension-runtime.mjs ./scripts/docker-extension-runtime.mjs

# 数据目录：挂载卷到 /data，配置文件为 /data/config.yaml
EXPOSE 6727

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/app/scripts/docker-healthcheck.mjs"]

# 若 /data/config.yaml 不存在则从示例复制，再启动网关
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]

# 默认：前台启动网关，使用 /data/config.yaml，并注册常用适配器与协议
CMD [ \
  "-c", "/data/config.yaml", \
  "-r", "kook", "-r", "qq", "-r", "telegram", "-r", "feishu", "-r", "slack", \
  "-r", "teams", "-r", "wecom", "-r", "wecom-kf", "-r", "discord", "-r", "dingtalk", "-r", "wechat", "-r", "wechat-clawbot", \
  "-p", "milky-v1", "-p", "satori-v1", "-p", "onebot-v12", "-p", "onebot-v11" \
]
