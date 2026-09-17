# monorepo 构建：build context = 仓库根目录
FROM node:22-alpine

WORKDIR /app

# 依赖清单（利用 layer 缓存）
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY simulator ./simulator

RUN npm install --workspace @a2t/api --include-workspace-root

EXPOSE 8000

CMD ["npm", "run", "start", "--workspace", "@a2t/api"]
