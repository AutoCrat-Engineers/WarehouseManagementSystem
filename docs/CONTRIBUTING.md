# Contributing Guide

> **Version:** 0.4.1 | **Last Updated:** 2026-03-06

## Getting Started

1. Clone the repository
2. Run `npm ci` to install dependencies
3. Run `npm run dev` to start the development server
4. Open `http://localhost:3000`

## Project Standards

### Code Style

- **TypeScript** — All new code must be typed
- **React Functional Components** — No class components
- **Named Exports** — Use named exports from barrel files (`index.ts`)
- **No `any` Types** — Use proper interfaces and generics

### File Naming

- Components: `PascalCase.tsx` (e.g., `PalletDashboard.tsx`)
- Services: `camelCase.ts` (e.g., `packingService.ts`)
- Types: `camelCase.ts` in `src/types/`
- Utilities: `camelCase.ts` in `src/utils/`

### Component Structure

```typescript
/**
 * ComponentName — Brief description
 *
 * Purpose and context
 * @version v0.4.1
 */
import React from 'react';

// Types
interface ComponentProps {
    // ...
}

// Component
export function ComponentName({ prop1, prop2 }: ComponentProps) {
    // hooks
    // handlers
    // render
}
```

### Service Layer Pattern

All database operations go through service files, never directly from components.

```typescript
// ✅ Correct: Component calls service
const boxes = await autoGenerateBoxes(requestId);

// ❌ Wrong: Component calls Supabase directly
const { data } = await supabase.from('packing_boxes').select('*');
```

### RBAC

When adding a new module, follow the `/add-new-module` workflow to ensure proper GRBAC coverage. Every module must have:

1. Entry in `module_registry` table
2. Default permissions for L1/L2/L3 roles
3. Permission check in `App.tsx` via `canAccessView()`
4. Granular permission props passed to component

### Performance Guidelines

- **Batch Database Operations** — Use bulk inserts/updates, never loop-and-insert
- **Parallel Fetches** — Use `Promise.all()` for independent data fetches
- **Pre-compute IDs** — Generate UUIDs client-side when possible (see `idGenerator.ts`)
- **Structured Logging** — Use `auditLogger.ts` for all critical operations

### Documentation

- Update `CHANGELOG.md` for every user-facing change
- Update architecture docs when adding new modules
- Include JSDoc comments on all exported functions

## Pull Request Process

1. Create a feature branch from `main`
2. Make changes, ensuring TypeScript compiles cleanly
3. Test locally with `npm run build`
4. Update documentation as needed
5. Submit PR with clear description of changes

## Adding a New Module

See the workflow at `.agents/workflows/add-new-module.md` for step-by-step instructions including:

- Component scaffolding
- Service layer setup
- GRBAC registration
- App.tsx integration
- Navigation menu addition
