# -------- Build stage --------
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# -------- Runtime stage --------
FROM nginx:alpine

# Copy the built frontend assets
COPY --from=build /app/build /usr/share/nginx/html

# Copy custom nginx config with PDF service reverse proxy rules
COPY devops/nginx/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
