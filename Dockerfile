# -------- Build stage --------
FROM node:20-alpine AS build

WORKDIR /app

# Build-time env vars baked into the JS bundle by Vite.
# Must be supplied via --build-arg in the CI build step; otherwise
# src/utils/supabase/info.tsx throws [FATAL] at runtime.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_PDF_SERVICE_URL
ARG VITE_PDF_SERVICE_API_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_PDF_SERVICE_URL=$VITE_PDF_SERVICE_URL
ENV VITE_PDF_SERVICE_API_KEY=$VITE_PDF_SERVICE_API_KEY

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# -------- Runtime stage --------
FROM nginx:1.27-alpine

# Copy built frontend
COPY --from=build /app/build /usr/share/nginx/html

# Copy nginx config as a template — nginx image's docker-entrypoint runs
# envsubst on /etc/nginx/templates/*.template at container start and writes
# the result to /etc/nginx/conf.d/. NGINX_ENVSUBST_FILTER_VARIABLES restricts
# substitution to PDF_API_KEY so nginx's own $remote_addr, $uri, $scheme, etc.
# are left untouched. PDF_API_KEY itself is supplied at `docker run --env`.
COPY devops/nginx/nginx.conf /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER_VARIABLES=PDF_API_KEY

# Remove the default nginx server config so it doesn't conflict with ours
RUN rm -f /etc/nginx/conf.d/default.conf

# Install curl for reliable healthcheck
RUN apk add --no-cache curl

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
