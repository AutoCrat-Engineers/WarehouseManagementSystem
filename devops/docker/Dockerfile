# ===== Stage 1: Build frontend =====
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies required for node-canvas
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconfig \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    libc6-compat

# Ensure node-gyp finds python
ENV PYTHON=/usr/bin/python3

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build


# ===== Stage 2: Serve with Nginx =====
FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
