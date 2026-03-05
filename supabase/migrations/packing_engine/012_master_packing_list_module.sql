-- ============================================================================
-- 012 — MASTER PACKING LIST (MPL) + PERFORMA INVOICE ENHANCEMENT
-- Enterprise-grade packing & dispatch module
--
-- Referenced from: .db_reference/presentschema.sql (35 existing tables)
--
-- New tables:
--   1. master_packing_lists        — MPL header with MPL-XXXXXX format
--   2. master_packing_list_pallets — MPL ↔ Pallet junction with inner box snapshot
--   3. dispatch_audit_log          — Enterprise audit trail for all dispatch ops
--   4. proforma_invoice_mpls       — PI ↔ MPL junction (replaces PI ↔ Invoice)
--
-- Designed for 100M+ record scalability:
--   - UUID primary keys (partition-safe)
--   - Composite + partial indexes for high-frequency lookups
--   - Denormalized totals for O(1) aggregation
--   - JSONB snapshots to avoid N+1 queries
--   - Prepared for range partitioning on created_at/performed_at
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════════
-- SEQUENCE: Human-readable MPL numbering
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS mpl_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS pi_number_seq START WITH 1 INCREMENT BY 1;


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE 1: master_packing_lists
-- The Master Packing List — groups pallets prepared for shipment.
-- Each MPL aggregates multiple pallets containing inner packing boxes.
-- ID Format: MPL-000001
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS master_packing_lists (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mpl_number              VARCHAR NOT NULL UNIQUE,  -- MPL-000001

    -- ─── Source linkage ───
    packing_list_id         UUID NOT NULL REFERENCES pack_packing_lists(id),
    packing_list_data_id    UUID REFERENCES pack_packing_list_data(id) ON DELETE SET NULL,

    -- ─── SAP References (Invoice / PO) ───
    invoice_number          VARCHAR,
    po_number               VARCHAR,

    -- ─── Aggregated totals (denormalized for O(1) dashboard reads) ───
    total_pallets           INTEGER NOT NULL DEFAULT 0,
    total_containers        INTEGER NOT NULL DEFAULT 0,
    total_quantity           INTEGER NOT NULL DEFAULT 0,
    total_net_weight_kg     NUMERIC(14,4) NOT NULL DEFAULT 0,
    total_gross_weight_kg   NUMERIC(14,4) NOT NULL DEFAULT 0,

    -- ─── Item info (denormalized for search performance) ───
    item_code               VARCHAR NOT NULL,
    item_name               VARCHAR,

    -- ─── State machine ───
    status                  VARCHAR NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN (
            'DRAFT',        -- Just created, pallets assigned
            'CONFIRMED',    -- Verified, weights entered
            'PRINTED',      -- Physical print generated
            'DISPATCHED',   -- Linked to proforma invoice, stock moved
            'CANCELLED'     -- Cancelled, pallets released
        )),

    -- ─── Print tracking ───
    printed_at              TIMESTAMPTZ,
    printed_by              UUID REFERENCES profiles(id),
    print_count             INTEGER NOT NULL DEFAULT 0,

    -- ─── Dispatch linkage ───
    dispatched_at           TIMESTAMPTZ,
    dispatched_by           UUID REFERENCES profiles(id),
    proforma_invoice_id     UUID REFERENCES pack_proforma_invoices(id),

    -- ─── Confirmation ───
    confirmed_at            TIMESTAMPTZ,
    confirmed_by            UUID REFERENCES profiles(id),

    -- ─── Cancellation ───
    cancelled_at            TIMESTAMPTZ,
    cancelled_by            UUID REFERENCES profiles(id),
    cancellation_reason     TEXT,

    -- ─── Metadata ───
    extra_data              JSONB DEFAULT '{}',
    notes                   TEXT,

    -- ─── Audit ───
    created_by              UUID NOT NULL REFERENCES profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by              UUID REFERENCES profiles(id),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version             INTEGER NOT NULL DEFAULT 1
);

COMMENT ON TABLE master_packing_lists IS 'Master Packing List — groups pallets for shipment dispatch. MPL-XXXXXX format.';
COMMENT ON COLUMN master_packing_lists.mpl_number IS 'Human-readable ID: MPL-000001';
COMMENT ON COLUMN master_packing_lists.status IS 'DRAFT → CONFIRMED → PRINTED → DISPATCHED | CANCELLED';


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE 2: master_packing_list_pallets
-- Junction table: MPL ↔ Pallet with packing breakdown snapshot.
-- Stores inner box details as JSONB to avoid N+1 container queries.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS master_packing_list_pallets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mpl_id                  UUID NOT NULL REFERENCES master_packing_lists(id) ON DELETE CASCADE,
    pallet_id               UUID NOT NULL REFERENCES pack_pallets(id),

    -- ─── Pallet snapshot (at time of MPL creation) ───
    pallet_number           VARCHAR NOT NULL,
    item_code               VARCHAR NOT NULL,
    item_name               VARCHAR,
    quantity                INTEGER NOT NULL,
    container_count         INTEGER NOT NULL,
    net_weight_kg           NUMERIC(12,4) NOT NULL DEFAULT 0,
    gross_weight_kg         NUMERIC(12,4) NOT NULL DEFAULT 0,

    -- ─── Inner box breakdown (JSONB snapshot for review screen) ───
    -- Format: [{"container_number":"CTN-000001","quantity":450,"type":"INNER_BOX","is_adjustment":false,"operator":"John Doe"}]
    inner_box_details       JSONB DEFAULT '[]',

    -- ─── Packing spec reference ───
    inner_box_qty           INTEGER,          -- From packing_specifications.inner_box_quantity
    contract_outer_qty      INTEGER,          -- From packing_specifications.outer_box_quantity

    -- ─── Sequence ───
    line_number             INTEGER NOT NULL DEFAULT 1,

    -- ─── Status tracking ───
    status                  VARCHAR NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'RELEASED')),  -- RELEASED = after MPL cancellation
    released_at             TIMESTAMPTZ,

    -- ─── Audit ───
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_mpl_pallet UNIQUE (mpl_id, pallet_id)
);

COMMENT ON TABLE master_packing_list_pallets IS 'MPL ↔ Pallet junction with inner box breakdown snapshot.';
COMMENT ON COLUMN master_packing_list_pallets.inner_box_details IS 'JSONB array of inner container details for the review screen.';
COMMENT ON COLUMN master_packing_list_pallets.status IS 'ACTIVE = pallet assigned. RELEASED = pallet freed after MPL cancellation.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE 3: dispatch_audit_log
-- Enterprise-grade audit trail for all MPL + PI lifecycle events.
-- Designed for partition on performed_at (monthly ranges).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dispatch_audit_log (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ─── What entity was affected ───
    entity_type             VARCHAR NOT NULL
        CHECK (entity_type IN (
            'MASTER_PACKING_LIST', 'PROFORMA_INVOICE',
            'PALLET', 'STOCK_MOVEMENT', 'DISPATCH'
        )),
    entity_id               UUID NOT NULL,
    entity_number           VARCHAR,  -- Human-readable: MPL-000001, PI-000001

    -- ─── What happened ───
    action                  VARCHAR NOT NULL
        CHECK (action IN (
            'CREATED', 'CONFIRMED', 'PRINTED', 'DISPATCHED',
            'CANCELLED', 'PALLET_RELEASED', 'STOCK_MOVED',
            'EMAIL_SENT', 'STATUS_CHANGED', 'UPDATED',
            'PALLET_LOCKED', 'PALLET_ASSIGNED'
        )),

    -- ─── State transition ───
    from_status             VARCHAR,
    to_status               VARCHAR,

    -- ─── Who did it ───
    performed_by            UUID NOT NULL REFERENCES profiles(id),
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ─── Details ───
    metadata                JSONB DEFAULT '{}',
    ip_address              VARCHAR,

    -- ─── Correlation (link related audit entries) ───
    correlation_id          UUID,
    parent_audit_id         UUID REFERENCES dispatch_audit_log(id)
);

COMMENT ON TABLE dispatch_audit_log IS 'Enterprise audit trail for MPL + PI dispatch lifecycle.';
COMMENT ON COLUMN dispatch_audit_log.correlation_id IS 'Groups related audit entries across entities (e.g., PI approval triggers multiple MPL status changes).';


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE 4: proforma_invoice_mpls
-- Junction: Proforma Invoice ↔ Master Packing List
-- A PI groups multiple MPLs into one outbound shipment batch.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proforma_invoice_mpls (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proforma_id             UUID NOT NULL REFERENCES pack_proforma_invoices(id),
    mpl_id                  UUID NOT NULL REFERENCES master_packing_lists(id),

    -- ─── Denormalized snapshot ───
    mpl_number              VARCHAR NOT NULL,
    invoice_number          VARCHAR,
    po_number               VARCHAR,
    item_code               VARCHAR NOT NULL,
    total_pallets           INTEGER NOT NULL,
    total_quantity           INTEGER NOT NULL,
    total_gross_weight_kg   NUMERIC(14,4) NOT NULL DEFAULT 0,
    line_number             INTEGER NOT NULL,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_proforma_mpl UNIQUE (proforma_id, mpl_id)
);

COMMENT ON TABLE proforma_invoice_mpls IS 'Proforma Invoice ↔ MPL junction. Groups MPLs into a shipment batch.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES: Optimized for 100M+ record scalability
-- Strategy: Composite indexes for multi-column search, partial indexes
-- for active records, DESC indexes for reverse chronological queries.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── master_packing_lists ───
CREATE INDEX IF NOT EXISTS idx_mpl_status ON master_packing_lists(status);
CREATE INDEX IF NOT EXISTS idx_mpl_item ON master_packing_lists(item_code);
CREATE INDEX IF NOT EXISTS idx_mpl_invoice ON master_packing_lists(invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mpl_po ON master_packing_lists(po_number) WHERE po_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mpl_created ON master_packing_lists(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpl_pl_id ON master_packing_lists(packing_list_id);
CREATE INDEX IF NOT EXISTS idx_mpl_proforma ON master_packing_lists(proforma_invoice_id) WHERE proforma_invoice_id IS NOT NULL;

-- Composite index for home page dashboard query
CREATE INDEX IF NOT EXISTS idx_mpl_home_page ON master_packing_lists(status, created_at DESC);

-- Full-text search composite for fast multi-field lookup
CREATE INDEX IF NOT EXISTS idx_mpl_search ON master_packing_lists(item_code, invoice_number, po_number);

-- ─── master_packing_list_pallets ───
CREATE INDEX IF NOT EXISTS idx_mplp_mpl ON master_packing_list_pallets(mpl_id);
CREATE INDEX IF NOT EXISTS idx_mplp_pallet ON master_packing_list_pallets(pallet_id);
CREATE INDEX IF NOT EXISTS idx_mplp_item ON master_packing_list_pallets(item_code);
CREATE INDEX IF NOT EXISTS idx_mplp_active ON master_packing_list_pallets(status) WHERE status = 'ACTIVE';

-- ─── dispatch_audit_log ───
CREATE INDEX IF NOT EXISTS idx_dal_entity ON dispatch_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_dal_action ON dispatch_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_dal_time ON dispatch_audit_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dal_correlation ON dispatch_audit_log(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dal_entity_time ON dispatch_audit_log(entity_type, entity_id, performed_at DESC);

-- ─── proforma_invoice_mpls ───
CREATE INDEX IF NOT EXISTS idx_pim_proforma ON proforma_invoice_mpls(proforma_id);
CREATE INDEX IF NOT EXISTS idx_pim_mpl ON proforma_invoice_mpls(mpl_id);
CREATE INDEX IF NOT EXISTS idx_pim_item ON proforma_invoice_mpls(item_code);


-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEWS: Operational Intelligence
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── MPL Home Page View (fast dashboard query) ───
CREATE OR REPLACE VIEW v_mpl_dashboard AS
SELECT
    m.id,
    m.mpl_number,
    m.invoice_number AS po_number_display,
    m.po_number,
    m.item_code,
    m.item_name,
    m.total_pallets,
    m.total_containers,
    m.total_quantity,
    m.total_net_weight_kg,
    m.total_gross_weight_kg,
    m.status,
    m.print_count,
    m.printed_at,
    m.created_at,
    m.created_by,
    p.full_name AS created_by_name,
    CASE WHEN m.print_count > 0 THEN 'PRINTED' ELSE 'NOT PRINTED' END AS printed_status,
    m.packing_list_id,
    pl.packing_list_number,
    m.proforma_invoice_id,
    pi.proforma_number
FROM master_packing_lists m
LEFT JOIN profiles p ON p.id = m.created_by
LEFT JOIN pack_packing_lists pl ON pl.id = m.packing_list_id
LEFT JOIN pack_proforma_invoices pi ON pi.id = m.proforma_invoice_id
ORDER BY m.created_at DESC;


-- ─── Full MPL Traceability View ───
CREATE OR REPLACE VIEW v_mpl_full_trace AS
SELECT
    pi.proforma_number,
    pi.status AS proforma_status,
    m.mpl_number,
    m.status AS mpl_status,
    m.invoice_number,
    m.po_number,
    mp.pallet_number,
    mp.item_code,
    mp.item_name,
    mp.quantity AS pallet_qty,
    mp.container_count AS pallet_containers,
    mp.inner_box_details,
    mp.net_weight_kg,
    mp.gross_weight_kg,
    pal.state AS pallet_state,
    pal.current_qty AS pallet_current_qty,
    dm.source_warehouse_id,
    dm.dest_warehouse_id,
    sw.warehouse_name AS source_warehouse,
    dw.warehouse_name AS dest_warehouse,
    dm.executed_at AS dispatch_time,
    dp.full_name AS dispatch_operator,
    m.created_at AS mpl_created_at,
    mcp.full_name AS mpl_created_by
FROM master_packing_lists m
LEFT JOIN master_packing_list_pallets mp ON mp.mpl_id = m.id
LEFT JOIN pack_pallets pal ON pal.id = mp.pallet_id
LEFT JOIN proforma_invoice_mpls pim ON pim.mpl_id = m.id
LEFT JOIN pack_proforma_invoices pi ON pi.id = pim.proforma_id
LEFT JOIN pack_dispatch_movements dm ON dm.proforma_id = pi.id AND dm.item_code = mp.item_code
LEFT JOIN inv_warehouses sw ON sw.id = dm.source_warehouse_id
LEFT JOIN inv_warehouses dw ON dw.id = dm.dest_warehouse_id
LEFT JOIN profiles dp ON dp.id = dm.executed_by
LEFT JOIN profiles mcp ON mcp.id = m.created_by
ORDER BY pi.proforma_number, m.mpl_number, mp.line_number;


-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTIONS: MPL Business Logic
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Generate next MPL number: MPL-000001 ───
CREATE OR REPLACE FUNCTION generate_mpl_number()
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    next_val INTEGER;
BEGIN
    next_val := nextval('mpl_number_seq');
    RETURN 'MPL-' || LPAD(next_val::TEXT, 6, '0');
END;
$$;

-- ─── Generate next PI number: PI-000001 ───
CREATE OR REPLACE FUNCTION generate_pi_number()
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    next_val INTEGER;
BEGIN
    next_val := nextval('pi_number_seq');
    RETURN 'PI-' || LPAD(next_val::TEXT, 6, '0');
END;
$$;

-- ─── Cancel MPL and release pallets ───
CREATE OR REPLACE FUNCTION cancel_mpl(
    p_mpl_id UUID,
    p_user_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mpl RECORD;
    v_pallet RECORD;
    v_correlation_id UUID := gen_random_uuid();
BEGIN
    -- Lock the MPL row
    SELECT * INTO v_mpl FROM master_packing_lists WHERE id = p_mpl_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MPL not found: %', p_mpl_id;
    END IF;

    -- Block cancellation if dispatched
    IF v_mpl.status = 'DISPATCHED' THEN
        RAISE EXCEPTION 'Cannot cancel MPL %: already dispatched', v_mpl.mpl_number;
    END IF;

    IF v_mpl.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'MPL % is already cancelled', v_mpl.mpl_number;
    END IF;

    -- 1. Release all pallets → READY state
    FOR v_pallet IN
        SELECT mp.pallet_id, mp.pallet_number
        FROM master_packing_list_pallets mp
        WHERE mp.mpl_id = p_mpl_id AND mp.status = 'ACTIVE'
    LOOP
        -- Reset pallet state to READY
        UPDATE pack_pallets
        SET state = 'READY',
            ready_at = now(),
            locked_at = NULL,
            dispatched_at = NULL,
            updated_at = now(),
            updated_by = p_user_id,
            row_version = row_version + 1
        WHERE id = v_pallet.pallet_id
          AND state IN ('LOCKED', 'READY');

        -- Mark junction as RELEASED
        UPDATE master_packing_list_pallets
        SET status = 'RELEASED',
            released_at = now()
        WHERE mpl_id = p_mpl_id AND pallet_id = v_pallet.pallet_id;

        -- Log pallet state change
        INSERT INTO pack_pallet_state_log (
            pallet_id, from_state, to_state, trigger_type,
            trigger_reference_id, trigger_reference_type,
            metadata, performed_by
        ) VALUES (
            v_pallet.pallet_id,
            'LOCKED', 'READY', 'CANCELLED',
            p_mpl_id, 'MASTER_PACKING_LIST',
            jsonb_build_object('mpl_number', v_mpl.mpl_number, 'reason', COALESCE(p_reason, 'MPL Cancelled')),
            p_user_id
        );

        -- Audit log for each pallet release
        INSERT INTO dispatch_audit_log (
            entity_type, entity_id, entity_number, action,
            from_status, to_status, performed_by, metadata, correlation_id
        ) VALUES (
            'PALLET', v_pallet.pallet_id, v_pallet.pallet_number,
            'PALLET_RELEASED',
            'LOCKED', 'READY', p_user_id,
            jsonb_build_object('source_mpl', v_mpl.mpl_number, 'reason', COALESCE(p_reason, 'MPL Cancelled')),
            v_correlation_id
        );
    END LOOP;

    -- 2. Update MPL status to CANCELLED
    UPDATE master_packing_lists
    SET status = 'CANCELLED',
        cancelled_at = now(),
        cancelled_by = p_user_id,
        cancellation_reason = p_reason,
        updated_at = now(),
        updated_by = p_user_id,
        row_version = row_version + 1
    WHERE id = p_mpl_id;

    -- 3. Audit log for MPL cancellation
    INSERT INTO dispatch_audit_log (
        entity_type, entity_id, entity_number, action,
        from_status, to_status, performed_by,
        metadata, correlation_id
    ) VALUES (
        'MASTER_PACKING_LIST', p_mpl_id, v_mpl.mpl_number,
        'CANCELLED',
        v_mpl.status, 'CANCELLED', p_user_id,
        jsonb_build_object(
            'pallets_released', (SELECT COUNT(*) FROM master_packing_list_pallets WHERE mpl_id = p_mpl_id),
            'reason', COALESCE(p_reason, 'User cancelled')
        ),
        v_correlation_id
    );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════════

-- master_packing_lists
ALTER TABLE master_packing_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mpl_select ON master_packing_lists;
DROP POLICY IF EXISTS mpl_insert ON master_packing_lists;
DROP POLICY IF EXISTS mpl_update ON master_packing_lists;
DROP POLICY IF EXISTS mpl_delete ON master_packing_lists;
CREATE POLICY mpl_select ON master_packing_lists FOR SELECT TO authenticated USING (true);
CREATE POLICY mpl_insert ON master_packing_lists FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY mpl_update ON master_packing_lists FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY mpl_delete ON master_packing_lists FOR DELETE TO authenticated USING (true);

-- master_packing_list_pallets
ALTER TABLE master_packing_list_pallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mplp_select ON master_packing_list_pallets;
DROP POLICY IF EXISTS mplp_insert ON master_packing_list_pallets;
DROP POLICY IF EXISTS mplp_update ON master_packing_list_pallets;
DROP POLICY IF EXISTS mplp_delete ON master_packing_list_pallets;
CREATE POLICY mplp_select ON master_packing_list_pallets FOR SELECT TO authenticated USING (true);
CREATE POLICY mplp_insert ON master_packing_list_pallets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY mplp_update ON master_packing_list_pallets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY mplp_delete ON master_packing_list_pallets FOR DELETE TO authenticated USING (true);

-- dispatch_audit_log
ALTER TABLE dispatch_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dal_select ON dispatch_audit_log;
DROP POLICY IF EXISTS dal_insert ON dispatch_audit_log;
CREATE POLICY dal_select ON dispatch_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY dal_insert ON dispatch_audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- proforma_invoice_mpls
ALTER TABLE proforma_invoice_mpls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pim_select ON proforma_invoice_mpls;
DROP POLICY IF EXISTS pim_insert ON proforma_invoice_mpls;
DROP POLICY IF EXISTS pim_delete ON proforma_invoice_mpls;
CREATE POLICY pim_select ON proforma_invoice_mpls FOR SELECT TO authenticated USING (true);
CREATE POLICY pim_insert ON proforma_invoice_mpls FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pim_delete ON proforma_invoice_mpls FOR DELETE TO authenticated USING (true);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SYNC SEQUENCE WITH EXISTING DATA (if any PLs exist, start after them)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Sync MPL sequence
DO $$
DECLARE
    max_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(
        CASE
            WHEN mpl_number ~ '^MPL-[0-9]+$'
            THEN SUBSTRING(mpl_number FROM 5)::INTEGER
            ELSE 0
        END
    ), 0) INTO max_num FROM master_packing_lists;
    IF max_num > 0 THEN
        PERFORM setval('mpl_number_seq', max_num);
    END IF;
END;
$$;

-- Sync PI sequence
DO $$
DECLARE
    max_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(
        CASE
            WHEN proforma_number ~ '^PI-[0-9]+$'
            THEN SUBSTRING(proforma_number FROM 4)::INTEGER
            ELSE 0
        END
    ), 0) INTO max_num FROM pack_proforma_invoices;
    IF max_num > 0 THEN
        PERFORM setval('pi_number_seq', max_num);
    END IF;
END;
$$;
