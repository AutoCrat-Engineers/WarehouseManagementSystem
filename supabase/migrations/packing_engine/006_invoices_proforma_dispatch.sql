-- ============================================================================
-- 006 — PACK_INVOICES + PACK_PROFORMA_INVOICES + junction + dispatch
-- Full invoice → proforma → stock transfer chain
-- ============================================================================

-- INVOICES
CREATE TABLE IF NOT EXISTS pack_invoices (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number        VARCHAR NOT NULL UNIQUE,
    packing_list_id       UUID NOT NULL REFERENCES pack_packing_lists(id),

    customer_code         VARCHAR,
    customer_name         VARCHAR,
    customer_po_number    VARCHAR,
    blanket_order_id      UUID REFERENCES blanket_orders(id),

    subtotal              NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency_code         VARCHAR NOT NULL DEFAULT 'USD',

    status                VARCHAR NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','CONFIRMED','PROFORMA_LINKED','CANCELLED')),

    total_pallets         INTEGER NOT NULL DEFAULT 0,
    total_quantity        INTEGER NOT NULL DEFAULT 0,
    total_gross_weight_kg NUMERIC(12,4) DEFAULT 0,

    invoice_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date              DATE,

    created_by            UUID NOT NULL REFERENCES profiles(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at          TIMESTAMPTZ,
    confirmed_by          UUID REFERENCES profiles(id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PROFORMA INVOICES
CREATE TABLE IF NOT EXISTS pack_proforma_invoices (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proforma_number       VARCHAR NOT NULL UNIQUE,

    customer_code         VARCHAR,
    customer_name         VARCHAR,

    total_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency_code         VARCHAR NOT NULL DEFAULT 'USD',

    status                VARCHAR NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','CONFIRMED','STOCK_MOVED','CANCELLED')),

    total_invoices        INTEGER NOT NULL DEFAULT 0,
    total_pallets         INTEGER NOT NULL DEFAULT 0,
    total_quantity        INTEGER NOT NULL DEFAULT 0,

    proforma_date         DATE NOT NULL DEFAULT CURRENT_DATE,

    stock_movement_id     UUID REFERENCES inv_movement_headers(id),
    stock_moved_at        TIMESTAMPTZ,
    stock_moved_by        UUID REFERENCES profiles(id),

    created_by            UUID NOT NULL REFERENCES profiles(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at          TIMESTAMPTZ,
    confirmed_by          UUID REFERENCES profiles(id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PROFORMA ↔ INVOICE junction
CREATE TABLE IF NOT EXISTS pack_proforma_invoice_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proforma_id           UUID NOT NULL REFERENCES pack_proforma_invoices(id),
    invoice_id            UUID NOT NULL REFERENCES pack_invoices(id),

    invoice_number        VARCHAR NOT NULL,
    invoice_amount        NUMERIC(14,2) NOT NULL,
    pallet_count          INTEGER NOT NULL,
    total_quantity        INTEGER NOT NULL,
    line_number           INTEGER NOT NULL,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_proforma_invoice UNIQUE (proforma_id, invoice_id)
);

-- DISPATCH MOVEMENTS
CREATE TABLE IF NOT EXISTS pack_dispatch_movements (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proforma_id           UUID NOT NULL REFERENCES pack_proforma_invoices(id),
    movement_header_id    UUID NOT NULL REFERENCES inv_movement_headers(id),

    source_warehouse_id   UUID NOT NULL REFERENCES inv_warehouses(id),
    dest_warehouse_id     UUID NOT NULL REFERENCES inv_warehouses(id),

    item_code             VARCHAR NOT NULL,
    quantity              INTEGER NOT NULL CHECK (quantity > 0),
    pallet_count          INTEGER NOT NULL,

    stock_ledger_id       UUID REFERENCES inv_stock_ledger(id),

    executed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    executed_by           UUID NOT NULL REFERENCES profiles(id)
);

-- RLS for all
ALTER TABLE pack_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY pi_select ON pack_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY pi_insert ON pack_invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pi_update ON pack_invoices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE pack_proforma_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY ppi_select ON pack_proforma_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY ppi_insert ON pack_proforma_invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ppi_update ON pack_proforma_invoices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE pack_proforma_invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ppii_select ON pack_proforma_invoice_items FOR SELECT TO authenticated USING (true);
CREATE POLICY ppii_insert ON pack_proforma_invoice_items FOR INSERT TO authenticated WITH CHECK (true);

ALTER TABLE pack_dispatch_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdm_select ON pack_dispatch_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY pdm_insert ON pack_dispatch_movements FOR INSERT TO authenticated WITH CHECK (true);
