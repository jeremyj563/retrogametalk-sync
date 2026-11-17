FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi

COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ARG GIT_SHA=unknown
ARG APP_VERSION=dev
ARG GIT_URL=""
ARG GIT_REF=""
ARG BUILT_AT=""
LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="${GIT_URL}" \
      org.opencontainers.image.created="${BUILT_AT}"
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV GIT_URL=${GIT_URL}
ENV GIT_REF=${GIT_REF}
ENV BUILT_AT=${BUILT_AT}

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/run/repo/.rgt-data
ENV DOWNLOAD_DIR=/run/repo

RUN apk add --no-cache curl 7zip \
  && addgroup -S rgt && adduser -S rgt -G rgt \
  && mkdir -p $DOWNLOAD_DIR $DATA_DIR /app/data \
  && chown -R rgt:rgt $DOWNLOAD_DIR /app/data

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/src/shared ./src/shared
COPY --from=builder /app/tsconfig.json ./tsconfig.json

USER rgt
EXPOSE 3000
VOLUME ["/run/repo"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.ts"]
