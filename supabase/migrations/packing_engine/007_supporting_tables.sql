-- ============================================================================
-- 007 — SUPPORTING TABLES
-- Email queue, aggregation counters, engine events
-- ============================================================================

-- EMAIL QUEUE
CREATE TABLE IF NOT EXISTS pack_email_queue (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type            VARCHAR NOT NULL
        CHECK (event_type IN (
            'PACKING_LIST_GENERATED','INVOICE_GENERATED',
            'PROFORMA_GENERATED','STOCK_MOVED_TRANSIT',
            'PALLET_READY','ADJUSTMENT_REQUIRED'
        )),
    reference_type        VARCHAR NOT NULL,
    reference_id          UUID NOT NULL,
    reference_number      VARCHAR NOT NULL,
    recipients            JSONB NOT NULL DEFAULT '[]',
    subject               VARCHAR NOT NULL,
    body_html             TEXT,
    body_text             TEXT,
    trace_data            JSONB DEFAULT '{}',
    status                VARCHAR NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','SENT','FAILED','SKIPPED')),
    sent_at               TIMESTAMPTZ,
    error_message         TEXT,
    retry_count           INTEGER NOT NULL DEFAULT 0,
    max_retries           INTEGER NOT NULL DEFAULT 3,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_peq_status ON pack_email_queue(status) WHERE status = 'PENDING';

-- AGGREGATION COUNTERS (materialized for sub-second queries)
CREATE TABLE IF NOT EXISTS pack_aggregation_counters (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code             VARCHAR NOT NULL,
    contract_config_id    UUID NOT NULL REFERENCES pack_contract_configs(id),
    total_containers      INTEGER NOT NULL DEFAULT 0,
    total_quantity        INTEGER NOT NULL DEFAULT 0,
    current_pallet_qty    INTEGER NOT NULL DEFAULT 0,
    pallets_completed     INTEGER NOT NULL DEFAULT 0,
    pallets_open          INTEGER NOT NULL DEFAULT 0,
    pallet_fill_pct       NUMERIC(5,2) NOT NULL DEFAULT 0,
    adjustment_needed     BOOLEAN NOT NULL DEFAULT FALSE,
    adjustment_qty        INTEGER NOT NULL DEFAULT 0,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_counter_item UNIQUE (item_code, contract_config_id)
);

-- ENGINE EVENTS (event sourcing log)
CREATE TABLE IF NOT EXISTS pack_engine_events (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type            VARCHAR NOT NULL,
    aggregate_type        VARCHAR NOT NULL,
    aggregate_id          UUID NOT NULL,
    payload               JSONB NOT NULL DEFAULT '{}',
    performed_by          UUID REFERENCES profiles(id),
    performed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    correlation_id        UUID,
    causation_id          UUID
);

CREATE INDEX IF NOT EXISTS idx_pee_aggregate ON pack_engine_events(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_pee_time ON pack_engine_events(performed_at);
CREATE INDEX IF NOT EXISTS idx_pee_corr ON pack_engine_events(correlation_id);

-- RLS
ALTER TABLE pack_email_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY peq_select ON pack_email_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY peq_insert ON pack_email_queue FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY peq_update ON pack_email_queue FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE pack_aggregation_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY pac_select ON pack_aggregation_counters FOR SELECT TO authenticated USING (true);
CREATE POLICY pac_insert ON pack_aggregation_counters FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pac_update ON pack_aggregation_counters FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE pack_engine_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY pee_select ON pack_engine_events FOR SELECT TO authenticated USING (true);
CREATE POLICY pee_insert ON pack_engine_events FOR INSERT TO authenticated WITH CHECK (true);
