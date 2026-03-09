# Deployment Guide

> **Version:** 0.4.1 | **Last Updated:** 2026-03-06

## Architecture

```
Developer → GitHub → GitHub Actions → Docker Hub → EC2 (Nginx)
```

## Prerequisites

- GitHub repository access
- Docker Hub account (`shravanaweb/wms`)
- AWS EC2 instance with Docker installed
- GitHub Secrets configured:
  - `DOCKER_USERNAME`
  - `DOCKER_PASSWORD`
  - `EC2_HOST`
  - `EC2_KEY`

## CI/CD Pipeline

The deployment is automated via `.github/workflows/deploy.yaml`.

### Trigger

Push to the `deploy/test-1` branch triggers the pipeline.

### Pipeline Steps

#### Job 1: Build & Test

1. Checkout code
2. Setup Node.js 18
3. `npm ci` — Install dependencies
4. `npm test --if-present` — Run tests
5. `npm run build` — Build production bundle

#### Job 2: Deploy

1. Login to Docker Hub
2. Build Docker image: `shravanaweb/wms:latest`
3. Push to Docker Hub
4. SSH to EC2 and execute deployment:
   - Stop and remove existing containers
   - Prune unused images
   - Pull latest image
   - Start validation container on port 8080
   - Wait 15s for startup
   - Validate container process running
   - HTTP health check: `curl -f http://localhost:8080`
   - Switch to production: restart on port 80

### Docker Configuration

**Dockerfile** (`devops/docker/Dockerfile`):

```dockerfile
# Build stage
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

# Runtime stage
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY devops/nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Nginx** (`devops/nginx/nginx.conf`):

- SPA routing: all paths → `index.html`
- Gzip compression for CSS, JS, JSON

## Manual Deployment

### Local Docker

```bash
# Build
npm run build

# Docker compose
docker compose up -d
```

### Direct EC2

```bash
# SSH to EC2
ssh -i your-key.pem ubuntu@your-ec2-host

# Pull and run
docker pull shravanaweb/wms:latest
docker stop wms && docker rm wms
docker run -d --name wms -p 80:80 --restart unless-stopped shravanaweb/wms:latest
```

## Database Migrations

Migrations must be run manually in the Supabase SQL Editor.

### Migration Order

```
supabase/migrations/packing_engine/001_contract_configs.sql
supabase/migrations/packing_engine/002_containers.sql
supabase/migrations/packing_engine/003_pallets.sql
supabase/migrations/packing_engine/004_pallet_containers_and_state_log.sql
supabase/migrations/packing_engine/005_packing_lists.sql
supabase/migrations/packing_engine/006_invoices_proforma_dispatch.sql
supabase/migrations/packing_engine/007_supporting_tables.sql
supabase/migrations/packing_engine/008_views.sql
supabase/migrations/packing_engine/009_add_weight_colour_to_items.sql
supabase/migrations/packing_engine/010_fix_engine_constraints.sql
supabase/migrations/packing_engine/011_master_packing_list.sql
supabase/migrations/packing_engine/012_master_packing_list_module.sql
supabase/migrations/packing_engine/013_performance_indexes.sql    ← NEW in v0.4.1
```

### v0.4.1 Migration

Run the performance indexes migration:

```sql
-- Run in Supabase SQL Editor
-- File: supabase/migrations/packing_engine/013_performance_indexes.sql
```

This adds 10 indexes targeting packing boxes, containers, pallets, warehouse stock, and audit logs.

## Post-Deployment Checklist

- [ ] Application loads at production URL
- [ ] Login works for L1, L2, L3 users
- [ ] Dashboard displays correct KPIs
- [ ] Stock movement creation works
- [ ] Packing sticker generation is fast (< 3s for 100 boxes)
- [ ] Stock transfer completes successfully
- [ ] Console logs show structured JSON format
- [ ] No JavaScript errors in browser console

## Rollback

In case of deployment failure:

```bash
# SSH to EC2
ssh -i your-key.pem ubuntu@your-ec2-host

# Rollback to previous image
docker stop wms && docker rm wms
docker run -d --name wms -p 80:80 --restart unless-stopped shravanaweb/wms:previous-tag
```

For database rollbacks, the indexes migration is safe to skip (no destructive changes).
