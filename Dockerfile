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

FROM eclipse-temurin:21-jdk-jammy AS jdk

FROM node:22-bookworm-slim

COPY --from=jdk /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    ripgrep \
    docker.io \
    unzip \
    zip \
    && rm -rf /var/lib/apt/lists/* \
    && git config --global --add safe.directory '*'

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
