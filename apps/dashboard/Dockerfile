# A2T — Dashboard（Next.js standalone 部署）
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0

# standalone 产物（含精简 node_modules + server.js）
COPY .next/standalone ./

# 静态资源（standalone 不含，需手动复制）
COPY .next/static ./apps/dashboard/.next/static

EXPOSE 3001

CMD ["node", "apps/dashboard/server.js"]
