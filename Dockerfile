FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY github-oauth-client-id* ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY github-oauth-client-id* ./
RUN mkdir -p /app/data && chmod 700 /app/data

ENV PORT=8787
ENV WORKSPACE=/workspace

EXPOSE 8787

CMD ["node", "dist/server.js"]
