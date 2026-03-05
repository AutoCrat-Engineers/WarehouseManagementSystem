-- ============================================================================
-- 001 — PACK_CONTRACT_CONFIGS
-- Contract-driven packing rules per item
-- Drives the aggregation engine: defines outer qty + inner box qty
-- ============================================================================

CREATE TABLE IF NOT EXISTS pack_contract_configs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id               UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    item_code             VARCHAR NOT NULL,

    -- Contract packing parameters
    contract_outer_qty    INTEGER NOT NULL CHECK (contract_outer_qty > 0),
    inner_box_qty         INTEGER NOT NULL CHECK (inner_box_qty > 0),

    -- Computed fields
    full_containers_per_pallet  INTEGER GENERATED ALWAYS AS (
        FLOOR(contract_outer_qty::NUMERIC / inner_box_qty::NUMERIC)::INTEGER
    ) STORED,
    adjustment_qty        INTEGER GENERATED ALWAYS AS (
        contract_outer_qty % inner_box_qty
    ) STORED,

    -- Customer / order linkage
    customer_code         VARCHAR,
    customer_name         VARCHAR,
    blanket_order_id      UUID REFERENCES blanket_orders(id),

    effective_from        DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to          DATE,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID REFERENCES profiles(id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            UUID REFERENCES profiles(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pack_cc_item ON pack_contract_configs(item_code);
CREATE INDEX IF NOT EXISTS idx_pack_cc_active ON pack_contract_configs(item_code, is_active) WHERE is_active = TRUE;

-- RLS
ALTER TABLE pack_contract_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pack_cc_select ON pack_contract_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY pack_cc_insert ON pack_contract_configs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pack_cc_update ON pack_contract_configs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pack_cc_delete ON pack_contract_configs FOR DELETE TO authenticated USING (true);
