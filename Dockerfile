# syntax=docker/dockerfile:1

# 1. Build the frontend
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# 2. Install backend deps + generate prisma client
FROM node:20-alpine AS backend-deps
WORKDIR /app/backend
COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm install && npx prisma generate

# 3. Runtime image
FROM node:20-alpine
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/
COPY --from=frontend /app/frontend/dist ./frontend/dist
WORKDIR /app/backend
RUN npx prisma generate
ENV NODE_ENV=production \
    PORT=4000 \
    DATABASE_URL=file:../data/app.db
RUN mkdir -p ./data
EXPOSE 4000
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node src/index.js"]
