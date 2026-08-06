# Minimal production image for Telos backend (CIG-11.1 / 09 Section 9)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S telos && adduser -S telos -G telos
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER telos
EXPOSE 3000
CMD ["node", "src/index.js"]
