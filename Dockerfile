# OneBots 多平台机器人网关 - Docker 镜像
# 构建：docker build -t onebots .
# 运行：docker run -p 6727:6727 -v ./data:/data onebots
# 持久化：将配置、数据库与静态校验文件放在挂载卷 /data；配置 public_static_dir: static 时，将可信域名 txt 放入宿主 ./data/static（容器内 /data/static）

FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
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
RUN pnpm install --no-frozen-lockfile --ignore-scripts
# 仅构建网关所需包（跳过 docs：VitePress 需 git，Alpine 镜像未安装且运行时不需要文档）
RUN pnpm build:packages && pnpm --filter='./protocols/*/*' --filter='./adapters/*' build

# 对宿主及本次源码中的公开扩展做 pnpm pack，让镜像内安装始终使用同一提交的兼容工件。
# adapter-icqq 已由 .dockerignore 排除；glob 只展开实际存在的公开目录。
COPY scripts/pack-control-runtime.mjs ./scripts/pack-control-runtime.mjs
RUN node scripts/pack-control-runtime.mjs /app/runtime-artifacts adapters/* protocols/*/protocol

# 生产依赖（去掉 devDependencies 以减小镜像）
# pnpm 10 的 prune 会移除 workspace 包之间的可解析链接；离线生产安装既裁剪
# devDependencies，也按锁文件重建这些链接，确保运行镜像能加载 @onebots/core。
RUN CI=true pnpm install --prod --offline --ignore-scripts

# ---------- 运行阶段 ----------
FROM node:24-alpine

ENV ONEBOTS_CONTAINER=1
ENV ONEBOTS_RUNTIME_ARTIFACTS=/app/runtime-artifacts/manifest.json
ENV COREPACK_HOME=/usr/local/share/corepack

RUN apk add --no-cache su-exec \
  && corepack enable \
  && corepack prepare pnpm@10.34.5 --activate \
  && chown -R node:node "$COREPACK_HOME" \
  && mkdir -p /data \
  && chown -R node:node /data
WORKDIR /app

# 从构建阶段复制产物
COPY --chown=node:node --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages ./packages
COPY --chown=node:node --from=builder /app/adapters ./adapters
COPY --chown=node:node --from=builder /app/protocols ./protocols
COPY --chown=node:node --from=builder /app/development ./development
COPY --chown=node:node --from=builder /app/runtime-artifacts ./runtime-artifacts
COPY --chown=node:node scripts/docker-healthcheck.mjs ./scripts/docker-healthcheck.mjs

# 数据目录：挂载卷到 /data，配置文件为 /data/config.yaml
EXPOSE 6727

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/app/scripts/docker-healthcheck.mjs"]

# 管理服务独立于网关运行，空数据卷直接提供控制台
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]

# 仅管理服务持有公共入口和网关生命周期。
CMD ["serve", "--data-dir", "/data", "--host", "0.0.0.0"]
