# OneBots 多平台机器人网关 - Docker 镜像
# 构建：docker build -t onebots .
# 运行：docker run -p 6727:6727 -v ./data:/data onebots
# 持久化：将配置、数据库与静态校验文件放在挂载卷 /data；配置 public_static_dir: static 时，将可信域名 txt 放入宿主 ./data/static（容器内 /data/static）

FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.0.2 --activate
WORKDIR /app

# 复制依赖声明与工作空间配置
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 复制各工作空间（.dockerignore 已排除 node_modules/lib 等）
COPY packages ./packages
COPY adapters ./adapters
COPY protocols ./protocols
COPY docs ./docs
COPY development ./development

# 安装依赖并构建（.dockerignore 已排除 adapter-icqq，无需 GitHub Packages token；锁文件与完整仓库可能不一致，故不用 --frozen-lockfile）
RUN pnpm install --no-frozen-lockfile
# 仅构建网关所需包（跳过 docs：VitePress 需 git，Alpine 镜像未安装且运行时不需要文档）
RUN pnpm build:packages && pnpm --filter='./protocols/*/*' --filter='./adapters/*' build

# 生产依赖（去掉 devDependencies 以减小镜像）
RUN pnpm prune --prod

# ---------- 运行阶段 ----------
FROM node:24-alpine

RUN corepack enable && corepack prepare pnpm@9.0.2 --activate
WORKDIR /app

# 从构建阶段复制产物
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/adapters ./adapters
COPY --from=builder /app/protocols ./protocols
COPY --from=builder /app/development ./development

# 数据目录：挂载卷到 /data，配置文件为 /data/config.yaml
EXPOSE 6727

# 若 /data/config.yaml 不存在则从示例复制，再启动网关
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]

# 默认：前台启动网关，使用 /data/config.yaml，并注册常用适配器与协议
CMD [ \
  "-c", "/data/config.yaml", \
  "-r", "kook", "-r", "qq", "-r", "telegram", "-r", "feishu", "-r", "slack", \
  "-r", "teams", "-r", "wecom", "-r", "wecom-kf", "-r", "discord", "-r", "dingtalk", "-r", "wechat", \
  "-p", "milky-v1", "-p", "satori-v1", "-p", "onebot-v12", "-p", "onebot-v11" \
]
