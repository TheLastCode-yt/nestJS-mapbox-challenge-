# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Instalar dependências do sistema
RUN apk add --no-cache libc6-compat

# Copiar arquivos de configuração
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Instalar dependências (incluindo devDependencies para build)
RUN npm ci

# Copiar Prisma
COPY prisma ./prisma/
RUN npx prisma generate

# Copiar código fonte
COPY . .

# Build da aplicação
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache libc6-compat curl

# Copiar apenas o necessário do builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

# Copiar script de inicialização
COPY start.sh ./
RUN chmod +x start.sh

# Criar usuário não-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 && \
    chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 5000

# Usar o script de inicialização
CMD ["./start.sh"]