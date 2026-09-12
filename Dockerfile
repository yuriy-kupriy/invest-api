# Single-stage and deliberately free of any ENV instruction: everything that
# `docker inspect --format '{{.Config.Env}}'` reports must belong to the base
# image. Configuration arrives at runtime (--env-file / compose), secrets as a volume.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build

# The spec has to be in the image: create-app.ts loads it as ../openapi/openapi.yaml
COPY openapi ./openapi
# The variable contract ships with the image; the real .env and secrets/ do not (.dockerignore)
COPY .env.example ./.env.example

EXPOSE 3000

CMD ["node", "dist/main.js"]
