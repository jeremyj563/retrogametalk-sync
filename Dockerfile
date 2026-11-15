FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV DOWNLOAD_DIR=/run/repo

RUN addgroup -S rgt && adduser -S rgt -G rgt \
  && mkdir -p $DOWNLOAD_DIR $DATA_DIR \
  && chown -R rgt:rgt $DOWNLOAD_DIR $DATA_DIR

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/tsconfig.json ./tsconfig.json

USER rgt
EXPOSE 3000
VOLUME ["/run/repo", "/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.ts"]
