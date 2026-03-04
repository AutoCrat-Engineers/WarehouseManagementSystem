-- ============================================================================
-- 003 — PACK_PALLETS
-- Outer containers / pallets with full state machine
-- ============================================================================

CREATE TABLE IF NOT EXISTS pack_pallets (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pallet_number         VARCHAR NOT NULL UNIQUE,

    -- Item + contract
    item_id               UUID NOT NULL REFERENCES items(id),
    item_code             VARCHAR NOT NULL,
    contract_config_id    UUID NOT NULL REFERENCES pack_contract_configs(id),

    -- Target vs actual
    target_qty            INTEGER NOT NULL,
    current_qty           INTEGER NOT NULL DEFAULT 0,
    container_count       INTEGER NOT NULL DEFAULT 0,
    adjustment_container_count INTEGER NOT NULL DEFAULT 0,

    -- Sequence
    sequence_number       INTEGER NOT NULL DEFAULT 1,

    -- State machine
    state                 VARCHAR NOT NULL DEFAULT 'OPEN'
        CHECK (state IN (
            'OPEN', 'FILLING', 'ADJUSTMENT_REQUIRED',
            'READY', 'LOCKED', 'DISPATCHED', 'IN_TRANSIT', 'CANCELLED'
        )),

    -- State timestamps
    opened_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    filling_at            TIMESTAMPTZ,
    adjustment_required_at TIMESTAMPTZ,
    ready_at              TIMESTAMPTZ,
    locked_at             TIMESTAMPTZ,
    dispatched_at         TIMESTAMPTZ,
    in_transit_at         TIMESTAMPTZ,
    cancelled_at          TIMESTAMPTZ,

    -- Location
    current_warehouse_id  UUID REFERENCES inv_warehouses(id),
    packing_list_id       UUID, -- FK added after pack_packing_lists

    created_by            UUID NOT NULL REFERENCES profiles(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            UUID REFERENCES profiles(id),
    row_version           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_pack_pal_item ON pack_pallets(item_code);
CREATE INDEX IF NOT EXISTS idx_pack_pal_state ON pack_pallets(state);
CREATE INDEX IF NOT EXISTS idx_pack_pal_item_state ON pack_pallets(item_code, state);
CREATE INDEX IF NOT EXISTS idx_pack_pal_ready ON pack_pallets(item_code) WHERE state = 'READY';
CREATE INDEX IF NOT EXISTS idx_pack_pal_filling ON pack_pallets(item_code) WHERE state IN ('OPEN','FILLING','ADJUSTMENT_REQUIRED');

ALTER TABLE pack_pallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY pack_pal_select ON pack_pallets FOR SELECT TO authenticated USING (true);
CREATE POLICY pack_pal_insert ON pack_pallets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pack_pal_update ON pack_pallets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
