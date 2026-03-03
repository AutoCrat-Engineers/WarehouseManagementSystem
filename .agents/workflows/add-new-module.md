---
description: How to add a new module/component with full Granular RBAC (GRBAC) coverage
---

# Adding a New Module with GRBAC

Every new module **must** have full Granular RBAC coverage. There are **4 files** that need changes (plus the component itself). Follow this checklist exactly.

---

## Pre-requisites
- Know the **module id** (kebab-case, e.g. `rack-view`, `quality-control`)
- Know which **actions** apply: `view`, `create`, `edit`, `delete`
- Know the **icon** from `lucide-react`

---

## Step 1 — Register in the Grant Access Modal (Single Source of Truth)

**File:** `src/auth/components/GrantAccessModal.tsx`

1. Import the icon at the top (if not already imported).
2. Add an entry to `MODULE_CONFIG[]` array in the correct position:

```ts
{
    id: '<module-id>',
    label: '<Human Label>',
    icon: <LucideIcon>,
    color: '<hex-color>',
    description: '<Short description>',
    actions: ['view', 'create', 'edit', 'delete'], // only applicable actions
},
```

If the module has **submodules** (like Packing), add a `submodules: [...]` array instead.

> This is the **single source of truth** for all RBAC permissions. The Grant Access modal auto-generates all permission keys from this config.

---

## Step 2 — Add View Permission Mapping in App.tsx

**File:** `src/App.tsx`

1. Add the module's `View` type to the `type View = ...` union.
2. Add a mapping in `VIEW_PERMISSION_MAP`:
   ```ts
   '<module-id>': '<module-id>.view',
   ```
3. Add the `canAccessView` check in `renderContent()`:
   ```tsx
   case '<module-id>':
     if (!canAccessView('<module-id>')) return renderAccessDenied('<Label>');
     return <ModuleComponent userRole={userRole} userPerms={userPerms} />;
   ```
4. Add the menu item to `menuItems[]` array.

---

## Step 3 — Accept RBAC Props in the Component

**File:** `src/components/<ModuleComponent>.tsx`

1. Add props interface:
   ```ts
   type UserRole = 'L1' | 'L2' | 'L3' | null;
   interface ModuleProps {
       userRole?: UserRole;
       userPerms?: Record<string, boolean>;
   }
   ```

2. Compute permission flags at the top of the component:
   ```ts
   const hasPerms = Object.keys(userPerms).length > 0;
   const canCreate = userRole === 'L3' || (hasPerms ? userPerms['<module-id>.create'] === true : true);
   const canEdit   = userRole === 'L3' || (hasPerms ? userPerms['<module-id>.edit'] === true : false);
   const canDelete = userRole === 'L3' || (hasPerms ? userPerms['<module-id>.delete'] === true : false);
   ```

3. Guard all mutable UI actions with these flags:
   - Create buttons → `{canCreate && <Button .../>}`
   - Edit buttons → `{canEdit && <Button .../>}`
   - Delete buttons → `{canDelete && <Button .../>}`

---

## Step 4 — Verify

1. **TypeScript**: Run `npx tsc --noEmit` — no new errors.
2. **UI**: Log in as L3, open User Management → Grant Access modal. The new module should appear in the permission matrix.
3. **Behavior**: Grant/revoke permissions for an L1/L2 user and verify buttons show/hide correctly.

---

## Reference: Existing Implementations

| Component | Module ID | File |
|-----------|-----------|------|
| Item Master | `items` | `src/components/ItemMasterSupabase.tsx` |
| Stock Movements | `stock-movements` | `src/components/StockMovement.tsx` |
| Packing Details | `packing.packing-details` | `src/components/packing/PackingDetails.tsx` |
| Rack View | `rack-view` | `src/components/RackView.tsx` |

---

## Common Mistakes to Avoid

- ❌ Forgetting to add the module to `MODULE_CONFIG` in `GrantAccessModal.tsx`
- ❌ Not passing `userPerms` from `App.tsx` to the component
- ❌ Using `userRole` checks alone instead of checking `userPerms` map
- ❌ Leaving action buttons unguarded (Add/Edit/Delete visible to everyone)
- ❌ Forgetting `VIEW_PERMISSION_MAP` entry (view-level access won't work)
