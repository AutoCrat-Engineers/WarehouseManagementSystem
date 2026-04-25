# 🏗️ WMS — Enterprise Architecture Documentation

> **Project**: AutoCrat Engineers — Warehouse Management System (WMS)
> **Version**: 0.5.5
> **Last Updated**: April 2026 (post-historical-migration)
> **Document Owner**: Team Optimus
>
> **For the BPA / Release / Rack-Storage / Goods-Receipt subsystem (added in 0.5.4–0.5.5)**, see [`docs/releases/IMPLEMENTATION_0.5.4_TO_0.5.5.md`](../releases/IMPLEMENTATION_0.5.4_TO_0.5.5.md) for the full technical change log.

---

## 📁 Architecture Document Index

This directory contains the **complete, decomposed architecture documentation** for the WMS application. Each file focuses on a single architectural concern, making it easy for any engineer, DBA, or architect to navigate.

| # | Document | Description |
|---|----------|-------------|
| 01 | [System Overview](./01-SYSTEM-OVERVIEW.md) | High-level system overview, tech stack, and design principles |
| 02 | [Layered Architecture](./02-LAYERED-ARCHITECTURE.md) | Full layered architecture diagram and layer responsibilities |
| 03 | [Frontend Architecture](./03-FRONTEND-ARCHITECTURE.md) | React component tree, routing, UI library, state management |
| 04 | [Authentication & RBAC](./04-AUTHENTICATION-RBAC.md) | Auth flow, role hierarchy, protected routes, JWT lifecycle |
| 05 | [Service Layer](./05-SERVICE-LAYER.md) | Client-side services, API communication, Supabase integration |
| 06 | [Backend — Edge Functions](./06-BACKEND-EDGE-FUNCTIONS.md) | Supabase Edge Functions, Hono framework, repository pattern |
| 07 | [Database Architecture](./07-DATABASE-ARCHITECTURE.md) | Full schema, table relationships, views, triggers, RLS |
| 08 | [Data Flow Diagrams](./08-DATA-FLOW-DIAGRAMS.md) | End-to-end data flows for every major operation |
| 09 | [Module Breakdown](./09-MODULE-BREAKDOWN.md) | Per-module deep dive: Item Master, Inventory, Forecasting, etc. |
| 10 | [Security Architecture](./10-SECURITY-ARCHITECTURE.md) | Security controls, RLS, audit logging, JWT, environment variables |
| 11 | [Deployment Architecture](./11-DEPLOYMENT-ARCHITECTURE.md) | Build pipeline, hosting, CDN, environment strategy |
| 12 | [Directory Structure](./12-DIRECTORY-STRUCTURE.md) | Full annotated project directory tree |

---

## 🧭 Quick Navigation

- **"I'm a new developer — where do I start?"** → [01-SYSTEM-OVERVIEW](./01-SYSTEM-OVERVIEW.md) → [12-DIRECTORY-STRUCTURE](./12-DIRECTORY-STRUCTURE.md)
- **"I need to understand the database"** → [07-DATABASE-ARCHITECTURE](./07-DATABASE-ARCHITECTURE.md)
- **"I need to understand auth/RBAC"** → [04-AUTHENTICATION-RBAC](./04-AUTHENTICATION-RBAC.md)
- **"I need to add a new module"** → [09-MODULE-BREAKDOWN](./09-MODULE-BREAKDOWN.md) → [03-FRONTEND-ARCHITECTURE](./03-FRONTEND-ARCHITECTURE.md)
- **"I need to deploy changes"** → [11-DEPLOYMENT-ARCHITECTURE](./11-DEPLOYMENT-ARCHITECTURE.md)
- **"I need to understand the PDF microservice"** → See `micro-services/pdf-service/` and `src/services/pdfServiceClient.ts`

### 📝 Architecture Notes (v0.5.0)

- **PDF Generation** has been extracted into a standalone microservice (`micro-services/pdf-service/`) with Docker + Azure Container Apps deployment. The main app communicates via `pdfServiceClient.ts` with automatic fallback.
- **Server-side filtering** is now the standard for all data modules — filters are applied at the database query level before pagination.
- **Dependencies cleaned** — 6 unused packages removed (hono, canvas, html2canvas, jspdf, jsbarcode, puppeteer).

---

© 2026 AutoCrat Engineers. All rights reserved.
