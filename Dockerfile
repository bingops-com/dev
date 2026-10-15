FROM docker.io/node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
LABEL org.opencontainers.image.source="https://github.com/bingops-com/dev"
WORKDIR /app
COPY --chown=node:node server.mjs package.json ./
COPY --chown=node:node web ./web
COPY --chown=node:node workspace ./workspace
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
