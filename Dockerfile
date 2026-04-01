FROM oven/bun:1-slim

WORKDIR /app
COPY package.json bun.lock* ./
COPY packages/ packages/
COPY apps/ apps/

RUN bun install --frozen-lockfile

# State directory for WeChat session
RUN mkdir -p /root/.cortex/wechat

ENV CORTEX_BASE_URL=http://cortex:8420/api/v1
EXPOSE 3000

CMD ["bun", "run", "start:ilink"]
