# syntax=docker/dockerfile:1
# HW #28: multi-stage, distroless runtime, non-root, no shell inside.
# Still free of any ENV instruction: configuration arrives at runtime
# (Kubernetes Secret / env), never baked into the image.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The private-registry token is a BuildKit secret: a tmpfs mount at
# /run/secrets/npm_token for this one RUN only. ARG would land in image
# metadata (docker history), COPY + rm would land in a layer's bytes.
# The .npmrc lives and dies inside this RUN; @invest has no packages, so the
# registry is never contacted — the token is wired exactly as a real one would be.
RUN --mount=type=secret,id=npm_token,required=true \
    printf '@invest:registry=https://npm.invest.invalid/\n//npm.invest.invalid/:_authToken=%s\n' \
      "$(cat /run/secrets/npm_token)" > /tmp/.npmrc \
 && npm ci --userconfig=/tmp/.npmrc \
 && rm /tmp/.npmrc
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# create-app.ts loads the spec as ../openapi/openapi.yaml
COPY openapi ./openapi
# Numeric, so kubelet can verify runAsNonRoot (a user name it cannot resolve)
USER 65532:65532
EXPOSE 3000
# The distroless entrypoint is already node
CMD ["dist/main.js"]
