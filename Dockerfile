# -------- Build stage --------
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# -------- Runtime stage --------
FROM nginx:1.27-alpine

# Copy the built frontend assets
COPY --from=build /app/build /usr/share/nginx/html

# Copy custom nginx config as TEMPLATE (envsubst will process it at startup)
COPY devops/nginx/nginx.conf /etc/nginx/templates/default.conf.template

# Healthcheck — verify NGINX is serving content
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost/ || exit 1

EXPOSE 80

# envsubst replaces ${PDF_API_KEY} in the template, then starts NGINX
# Only substitute PDF_API_KEY to avoid replacing NGINX's own $variables
CMD ["/bin/sh", "-c", "envsubst '${PDF_API_KEY}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
