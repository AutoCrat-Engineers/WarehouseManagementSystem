-- ============================================================================
-- 002 — PACK_CONTAINERS
-- Individual inner containers — traceable to stock movement + operator
-- ============================================================================

CREATE TABLE IF NOT EXISTS pack_containers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_number      VARCHAR NOT NULL UNIQUE,

    -- Source traceability
    movement_header_id    UUID NOT NULL REFERENCES inv_movement_headers(id),
    movement_number       VARCHAR NOT NULL,
    packing_request_id    UUID REFERENCES packing_requests(id),
    packing_box_id        UUID REFERENCES packing_boxes(id),

    -- Item
    item_id               UUID NOT NULL REFERENCES items(id),
    item_code             VARCHAR NOT NULL,
    contract_config_id    UUID NOT NULL REFERENCES pack_contract_configs(id),

    -- Quantity
    quantity              INTEGER NOT NULL CHECK (quantity > 0),
    is_adjustment         BOOLEAN NOT NULL DEFAULT FALSE,
    container_type        VARCHAR NOT NULL DEFAULT 'INNER_BOX'
        CHECK (container_type IN ('INNER_BOX', 'ADJUSTMENT_BOX')),

    -- Sticker
    sticker_printed       BOOLEAN NOT NULL DEFAULT FALSE,
    sticker_printed_at    TIMESTAMPTZ,
    sticker_data          JSONB DEFAULT '{}',

    -- Location
    current_warehouse_id  UUID REFERENCES inv_warehouses(id),

    -- Operator
    created_by            UUID NOT NULL REFERENCES profiles(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Reference doc
    reference_doc_type    VARCHAR,
    reference_doc_number  VARCHAR
);

CREATE INDEX IF NOT EXISTS idx_pack_ctn_item ON pack_containers(item_code);
CREATE INDEX IF NOT EXISTS idx_pack_ctn_movement ON pack_containers(movement_header_id);
CREATE INDEX IF NOT EXISTS idx_pack_ctn_config ON pack_containers(contract_config_id);
CREATE INDEX IF NOT EXISTS idx_pack_ctn_created ON pack_containers(created_at);

ALTER TABLE pack_containers ENABLE ROW LEVEL SECURITY;
CREATE POLICY pack_ctn_select ON pack_containers FOR SELECT TO authenticated USING (true);
CREATE POLICY pack_ctn_insert ON pack_containers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pack_ctn_update ON pack_containers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
