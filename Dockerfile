# ---- Build the 3D client ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm install --no-audit --no-fund
COPY shared shared
COPY client client
RUN npm run build -w client

# ---- Runtime: Node server (authoritative game engine + static client) ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY server/package.json server/
RUN npm install --omit=dev --no-audit --no-fund --workspace server
COPY server server
COPY shared shared
COPY admin-codes.json ./
COPY --from=build /app/client/dist client/dist
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "server/src/index.ts"]
