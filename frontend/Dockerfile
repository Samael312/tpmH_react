FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Necesario para el build estático
# IMPORTANTE: toda variable NEXT_PUBLIC_* debe declararse aquí como ARG/ENV,
# porque Next.js la inlinea en el JS del cliente durante `npm run build`
# (dentro de este stage), no en runtime. Si Railway solo la tiene configurada
# como variable de servicio pero no está declarada aquí, el build la ignora
# por completo y el bundle final queda con un valor vacío o desactualizado
# — sin importar lo que se cambie después en el panel de Railway.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_FEATURED_TEACHER_USERNAME
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_FEATURED_TEACHER_USERNAME=$NEXT_PUBLIC_FEATURED_TEACHER_USERNAME
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]