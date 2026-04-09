# ── Build stage ──
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .

# Production env: PDF calls go through nginx (same-origin), no API key exposed
ENV VITE_PDF_SERVICE_URL=
ENV VITE_PDF_SERVICE_API_KEY=

RUN npm run build

# ── Runtime stage ──
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY devops/nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
