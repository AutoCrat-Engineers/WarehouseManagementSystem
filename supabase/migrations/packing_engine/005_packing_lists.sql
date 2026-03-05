-- ============================================================================
-- 005 — PACK_PACKING_LISTS + PACK_PACKING_LIST_ITEMS
-- Packing list header + line items (pallets selected for dispatch)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pack_packing_lists (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    packing_list_number   VARCHAR NOT NULL UNIQUE,

    customer_code         VARCHAR,
    customer_name         VARCHAR,
    blanket_order_id      UUID REFERENCES blanket_orders(id),

    status                VARCHAR NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','CONFIRMED','INVOICED','CANCELLED')),

    total_pallets         INTEGER NOT NULL DEFAULT 0,
    total_containers      INTEGER NOT NULL DEFAULT 0,
    total_quantity        INTEGER NOT NULL DEFAULT 0,
    total_gross_weight_kg NUMERIC(12,4) DEFAULT 0,
    total_net_weight_kg   NUMERIC(12,4) DEFAULT 0,

    picking_draft_generated BOOLEAN NOT NULL DEFAULT FALSE,
    picking_draft_data    JSONB DEFAULT '{}',

    dispatch_date         DATE,
    vehicle_number        VARCHAR,
    driver_name           VARCHAR,
    seal_number           VARCHAR,

    created_by            UUID NOT NULL REFERENCES profiles(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at          TIMESTAMPTZ,
    confirmed_by          UUID REFERENCES profiles(id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pack_packing_list_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    packing_list_id       UUID NOT NULL REFERENCES pack_packing_lists(id),
    pallet_id             UUID NOT NULL REFERENCES pack_pallets(id),

    item_code             VARCHAR NOT NULL,
    item_name             VARCHAR,
    quantity              INTEGER NOT NULL,
    container_count       INTEGER NOT NULL,
    gross_weight_kg       NUMERIC(12,4),
    net_weight_kg         NUMERIC(12,4),
    line_number           INTEGER NOT NULL,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_pl_pallet UNIQUE (packing_list_id, pallet_id)
);

CREATE INDEX IF NOT EXISTS idx_ppli_pl ON pack_packing_list_items(packing_list_id);
CREATE INDEX IF NOT EXISTS idx_ppli_pallet ON pack_packing_list_items(pallet_id);

-- RLS
ALTER TABLE pack_packing_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY ppl_select ON pack_packing_lists FOR SELECT TO authenticated USING (true);
CREATE POLICY ppl_insert ON pack_packing_lists FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ppl_update ON pack_packing_lists FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE pack_packing_list_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ppli_select ON pack_packing_list_items FOR SELECT TO authenticated USING (true);
CREATE POLICY ppli_insert ON pack_packing_list_items FOR INSERT TO authenticated WITH CHECK (true);
