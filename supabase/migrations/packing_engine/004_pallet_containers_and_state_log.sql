-- ============================================================================
-- 004 — PACK_PALLET_CONTAINERS + PACK_PALLET_STATE_LOG
-- Junction mapping + state audit trail
-- ============================================================================

-- Container ↔ Pallet mapping
CREATE TABLE IF NOT EXISTS pack_pallet_containers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pallet_id             UUID NOT NULL REFERENCES pack_pallets(id),
    container_id          UUID NOT NULL REFERENCES pack_containers(id),
    position_sequence     INTEGER NOT NULL,
    assigned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by           UUID NOT NULL REFERENCES profiles(id),
    CONSTRAINT uq_container_pallet UNIQUE (container_id)
);

CREATE INDEX IF NOT EXISTS idx_ppc_pallet ON pack_pallet_containers(pallet_id);
CREATE INDEX IF NOT EXISTS idx_ppc_container ON pack_pallet_containers(container_id);

-- State transition audit trail
CREATE TABLE IF NOT EXISTS pack_pallet_state_log (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pallet_id             UUID NOT NULL REFERENCES pack_pallets(id),
    from_state            VARCHAR NOT NULL,
    to_state              VARCHAR NOT NULL,
    trigger_type          VARCHAR NOT NULL
        CHECK (trigger_type IN (
            'CONTAINER_ADDED','ADJUSTMENT_DETECTED','ADJUSTMENT_RESOLVED',
            'PALLET_COMPLETE','PALLET_LOCKED','DISPATCH_EXECUTED',
            'STOCK_MOVED','MANUAL_OVERRIDE','SYSTEM_AUTO','CANCELLED'
        )),
    trigger_reference_id  UUID,
    trigger_reference_type VARCHAR,
    metadata              JSONB DEFAULT '{}',
    performed_by          UUID NOT NULL REFERENCES profiles(id),
    performed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppsl_pallet ON pack_pallet_state_log(pallet_id);
CREATE INDEX IF NOT EXISTS idx_ppsl_time ON pack_pallet_state_log(performed_at);

-- RLS
ALTER TABLE pack_pallet_containers ENABLE ROW LEVEL SECURITY;
CREATE POLICY ppc_select ON pack_pallet_containers FOR SELECT TO authenticated USING (true);
CREATE POLICY ppc_insert ON pack_pallet_containers FOR INSERT TO authenticated WITH CHECK (true);

ALTER TABLE pack_pallet_state_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY ppsl_select ON pack_pallet_state_log FOR SELECT TO authenticated USING (true);
CREATE POLICY ppsl_insert ON pack_pallet_state_log FOR INSERT TO authenticated WITH CHECK (true);
