-- ============================================================================
-- ENTERPRISE INVENTORY MANAGEMENT EXTENSION
-- Multi-Warehouse Inventory Model for Global Supply Chain
-- 
-- Version: 1.0.0
-- Date: 2026-02-06
-- Author: Enterprise Database Architecture Team
-- 
-- COMPATIBILITY: Extends existing schema without breaking changes
-- PATTERN: Additive schema evolution with backward compatibility
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- SECTION 1: ENUMERATED TYPES FOR DATA INTEGRITY
-- ============================================================================

-- Warehouse Type Enum (extensible via lookup table, but enum for core types)
DO $$ BEGIN
    CREATE TYPE warehouse_category AS ENUM (
        'PRODUCTION',
        'IN_TRANSIT', 
        'SNV',
        'US_TRANSIT',
        'DISTRIBUTION',
        'RETURNS',
        'QUARANTINE'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Movement Status Lifecycle
DO $$ BEGIN
    CREATE TYPE movement_status AS ENUM (
        'DRAFT',
        'PENDING_APPROVAL',
        'APPROVED',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
        'REJECTED'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Approval Status
DO $$ BEGIN
    CREATE TYPE approval_status AS ENUM (
        'PENDING',
        'APPROVED',
        'REJECTED',
        'ESCALATED'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Stock Transaction Type
DO $$ BEGIN
    CREATE TYPE stock_transaction_type AS ENUM (
        'RECEIPT',
        'ISSUE',
        'TRANSFER_OUT',
        'TRANSFER_IN',
        'ADJUSTMENT_PLUS',
        'ADJUSTMENT_MINUS',
        'BLANKET_RELEASE',
        'RETURN',
        'SCRAP',
        'CYCLE_COUNT'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- SECTION 2: WAREHOUSE MASTER TABLES
-- ============================================================================

-- Warehouse Type Master (Extensible Lookup Table)
CREATE TABLE IF NOT EXISTS public.inv_warehouse_types (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    type_code character varying(20) NOT NULL,
    type_name character varying(100) NOT NULL,
    category warehouse_category NOT NULL,
    description text,
    is_transit_point boolean DEFAULT false,
    is_production_site boolean DEFAULT false,
    can_ship_external boolean DEFAULT false,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    CONSTRAINT inv_warehouse_types_pkey PRIMARY KEY (id),
    CONSTRAINT inv_warehouse_types_code_key UNIQUE (type_code)
);

COMMENT ON TABLE public.inv_warehouse_types IS 'Master table for warehouse type definitions - extensible for future warehouse types';
COMMENT ON COLUMN public.inv_warehouse_types.is_transit_point IS 'If true, stock here is considered in-transit';
COMMENT ON COLUMN public.inv_warehouse_types.can_ship_external IS 'If true, can ship to customers directly';

-- Warehouse Master
CREATE TABLE IF NOT EXISTS public.inv_warehouses (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    warehouse_code character varying(20) NOT NULL,
    warehouse_name character varying(100) NOT NULL,
    warehouse_type_id uuid NOT NULL,
    country_code character varying(3) NOT NULL,
    region character varying(50),
    city character varying(100),
    address text,
    postal_code character varying(20),
    timezone character varying(50) DEFAULT 'UTC',
    manager_user_id uuid,
    parent_warehouse_id uuid,
    capacity_units integer,
    current_utilization_pct numeric(5,2) DEFAULT 0,
    is_active boolean DEFAULT true,
    is_deleted boolean DEFAULT false,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    CONSTRAINT inv_warehouses_pkey PRIMARY KEY (id),
    CONSTRAINT inv_warehouses_code_key UNIQUE (warehouse_code),
    CONSTRAINT inv_warehouses_type_fkey FOREIGN KEY (warehouse_type_id) 
        REFERENCES public.inv_warehouse_types(id),
    CONSTRAINT inv_warehouses_parent_fkey FOREIGN KEY (parent_warehouse_id) 
        REFERENCES public.inv_warehouses(id),
    CONSTRAINT inv_warehouses_manager_fkey FOREIGN KEY (manager_user_id) 
        REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.inv_warehouses IS 'Multi-warehouse master with hierarchical support for global operations';

-- ============================================================================
-- SECTION 3: MULTI-WAREHOUSE INVENTORY BALANCE
-- ============================================================================

-- Warehouse-Level Inventory Balance (replaces single-warehouse model)
CREATE TABLE IF NOT EXISTS public.inv_warehouse_stock (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    warehouse_id uuid NOT NULL,
    item_code character varying NOT NULL,
    lot_number character varying(50),
    batch_number character varying(50),
    serial_number character varying(100),
    quantity_on_hand integer NOT NULL DEFAULT 0,
    quantity_allocated integer NOT NULL DEFAULT 0,
    quantity_reserved integer NOT NULL DEFAULT 0,
    quantity_in_transit integer NOT NULL DEFAULT 0,
    quantity_available integer GENERATED ALWAYS AS (
        quantity_on_hand - quantity_allocated - quantity_reserved
    ) STORED,
    unit_cost numeric(18,4),
    last_receipt_date timestamp with time zone,
    last_issue_date timestamp with time zone,
    expiry_date date,
    manufacture_date date,
    quality_status character varying(20) DEFAULT 'GOOD',
    storage_location character varying(50),
    bin_number character varying(20),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    row_version integer DEFAULT 1,
    CONSTRAINT inv_warehouse_stock_pkey PRIMARY KEY (id),
    CONSTRAINT inv_warehouse_stock_warehouse_fkey FOREIGN KEY (warehouse_id) 
        REFERENCES public.inv_warehouses(id),
    CONSTRAINT inv_warehouse_stock_item_fkey FOREIGN KEY (item_code) 
        REFERENCES public.items(item_code),
    CONSTRAINT inv_warehouse_stock_qty_positive CHECK (quantity_on_hand >= 0),
    CONSTRAINT inv_warehouse_stock_available_check CHECK (quantity_available >= 0)
);

-- Create unique index for warehouse stock (handles NULL values properly)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_warehouse_stock_unique 
    ON public.inv_warehouse_stock (
        warehouse_id, 
        item_code, 
        COALESCE(lot_number, ''), 
        COALESCE(batch_number, '')
    );

COMMENT ON TABLE public.inv_warehouse_stock IS 'Per-warehouse inventory balance with lot/batch tracking - enforces no duplicates';
COMMENT ON COLUMN public.inv_warehouse_stock.row_version IS 'Optimistic concurrency control for transaction safety';

-- ============================================================================
-- SECTION 4: STOCK MOVEMENT WITH APPROVAL WORKFLOW
-- ============================================================================

-- Movement Header (Document Level)
CREATE TABLE IF NOT EXISTS public.inv_movement_headers (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    movement_number character varying(30) NOT NULL,
    movement_date date NOT NULL DEFAULT CURRENT_DATE,
    movement_type character varying(30) NOT NULL,
    source_warehouse_id uuid,
    destination_warehouse_id uuid,
    status movement_status NOT NULL DEFAULT 'DRAFT',
    approval_status approval_status DEFAULT 'PENDING',
    priority character varying(10) DEFAULT 'NORMAL',
    reference_document_type character varying(30),
    reference_document_id uuid,
    reference_document_number character varying(50),
    reason_code character varying(20),
    reason_description text,
    notes text,
    requested_by uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now(),
    approved_by uuid,
    approved_at timestamp with time zone,
    completed_by uuid,
    completed_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    is_deleted boolean DEFAULT false,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    CONSTRAINT inv_movement_headers_pkey PRIMARY KEY (id),
    CONSTRAINT inv_movement_headers_number_key UNIQUE (movement_number),
    CONSTRAINT inv_movement_headers_source_fkey FOREIGN KEY (source_warehouse_id) 
        REFERENCES public.inv_warehouses(id),
    CONSTRAINT inv_movement_headers_dest_fkey FOREIGN KEY (destination_warehouse_id) 
        REFERENCES public.inv_warehouses(id),
    CONSTRAINT inv_movement_headers_requested_fkey FOREIGN KEY (requested_by) 
        REFERENCES public.profiles(id),
    CONSTRAINT inv_movement_headers_approved_fkey FOREIGN KEY (approved_by) 
        REFERENCES public.profiles(id),
    CONSTRAINT inv_movement_headers_warehouse_check CHECK (
        (movement_type = 'ADJUSTMENT' AND source_warehouse_id IS NOT NULL) OR
        (movement_type != 'ADJUSTMENT' AND source_warehouse_id IS NOT NULL AND destination_warehouse_id IS NOT NULL)
    )
);

COMMENT ON TABLE public.inv_movement_headers IS 'Movement document header with full approval workflow';

-- Movement Lines (Line Item Level)
CREATE TABLE IF NOT EXISTS public.inv_movement_lines (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    header_id uuid NOT NULL,
    line_number integer NOT NULL,
    item_code character varying NOT NULL,
    lot_number character varying(50),
    batch_number character varying(50),
    requested_quantity integer NOT NULL,
    approved_quantity integer,
    actual_quantity integer,
    unit_cost numeric(18,4),
    line_status character varying(20) DEFAULT 'PENDING',
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    CONSTRAINT inv_movement_lines_pkey PRIMARY KEY (id),
    CONSTRAINT inv_movement_lines_header_fkey FOREIGN KEY (header_id) 
        REFERENCES public.inv_movement_headers(id) ON DELETE CASCADE,
    CONSTRAINT inv_movement_lines_item_fkey FOREIGN KEY (item_code) 
        REFERENCES public.items(item_code),
    CONSTRAINT inv_movement_lines_unique UNIQUE (header_id, line_number),
    CONSTRAINT inv_movement_lines_qty_positive CHECK (requested_quantity > 0)
);

COMMENT ON TABLE public.inv_movement_lines IS 'Movement line items with lot/batch detail';

-- ============================================================================
-- SECTION 5: STOCK LEDGER (APPEND-ONLY AUDIT TRAIL)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_stock_ledger (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    ledger_date timestamp with time zone NOT NULL DEFAULT now(),
    warehouse_id uuid NOT NULL,
    item_code character varying NOT NULL,
    lot_number character varying(50),
    batch_number character varying(50),
    transaction_type stock_transaction_type NOT NULL,
    transaction_id uuid,
    transaction_number character varying(50),
    quantity_change integer NOT NULL,
    quantity_before integer NOT NULL,
    quantity_after integer NOT NULL,
    unit_cost numeric(18,4),
    total_value numeric(18,4),
    reference_type character varying(30),
    reference_id uuid,
    reference_number character varying(50),
    source_warehouse_id uuid,
    destination_warehouse_id uuid,
    reason_code character varying(20),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT inv_stock_ledger_pkey PRIMARY KEY (id),
    CONSTRAINT inv_stock_ledger_warehouse_fkey FOREIGN KEY (warehouse_id) 
        REFERENCES public.inv_warehouses(id),
    CONSTRAINT inv_stock_ledger_item_fkey FOREIGN KEY (item_code) 
        REFERENCES public.items(item_code)
);

COMMENT ON TABLE public.inv_stock_ledger IS 'Immutable append-only stock transaction ledger for full traceability';

-- ============================================================================
-- SECTION 6: APPROVAL WORKFLOW
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_approvals (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    entity_type character varying(30) NOT NULL,
    entity_id uuid NOT NULL,
    approval_level integer NOT NULL DEFAULT 1,
    approval_sequence integer NOT NULL DEFAULT 1,
    approver_role character varying(10) NOT NULL,
    approver_user_id uuid,
    status approval_status NOT NULL DEFAULT 'PENDING',
    comments text,
    approved_at timestamp with time zone,
    due_date timestamp with time zone,
    escalated_to uuid,
    escalated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    CONSTRAINT inv_approvals_pkey PRIMARY KEY (id),
    CONSTRAINT inv_approvals_approver_fkey FOREIGN KEY (approver_user_id) 
        REFERENCES public.profiles(id),
    CONSTRAINT inv_approvals_unique UNIQUE (entity_type, entity_id, approval_level, approval_sequence)
);

COMMENT ON TABLE public.inv_approvals IS 'Flexible approval workflow supporting multi-level approvals';

-- ============================================================================
-- SECTION 7: REFERENCE DOCUMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_reference_documents (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    document_type character varying(30) NOT NULL,
    document_number character varying(50) NOT NULL,
    document_date date NOT NULL,
    external_reference character varying(100),
    description text,
    status character varying(20) DEFAULT 'ACTIVE',
    valid_from date,
    valid_until date,
    total_value numeric(18,4),
    currency_code character varying(3) DEFAULT 'USD',
    customer_code character varying(50),
    vendor_code character varying(50),
    attachment_url text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    CONSTRAINT inv_reference_documents_pkey PRIMARY KEY (id),
    CONSTRAINT inv_reference_documents_unique UNIQUE (document_type, document_number)
);

COMMENT ON TABLE public.inv_reference_documents IS 'Reference document registry for traceability';

-- ============================================================================
-- SECTION 8: REASON CODES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_reason_codes (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    reason_code character varying(20) NOT NULL,
    reason_category character varying(30) NOT NULL,
    description character varying(200) NOT NULL,
    requires_approval boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inv_reason_codes_pkey PRIMARY KEY (id),
    CONSTRAINT inv_reason_codes_code_key UNIQUE (reason_code)
);

COMMENT ON TABLE public.inv_reason_codes IS 'Standardized reason codes for movements and adjustments';

-- ============================================================================
-- SECTION 9: BLANKET RELEASE STOCK OUT INTEGRATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_blanket_release_stock (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    release_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    item_code character varying NOT NULL,
    lot_number character varying(50),
    batch_number character varying(50),
    quantity_released integer NOT NULL,
    stock_ledger_id uuid,
    release_status character varying(20) DEFAULT 'PENDING',
    validated_at timestamp with time zone,
    validated_by uuid,
    released_at timestamp with time zone,
    released_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT inv_blanket_release_stock_pkey PRIMARY KEY (id),
    CONSTRAINT inv_blanket_release_stock_release_fkey FOREIGN KEY (release_id) 
        REFERENCES public.blanket_releases(id),
    CONSTRAINT inv_blanket_release_stock_warehouse_fkey FOREIGN KEY (warehouse_id) 
        REFERENCES public.inv_warehouses(id),
    CONSTRAINT inv_blanket_release_stock_item_fkey FOREIGN KEY (item_code) 
        REFERENCES public.items(item_code),
    CONSTRAINT inv_blanket_release_stock_ledger_fkey FOREIGN KEY (stock_ledger_id) 
        REFERENCES public.inv_stock_ledger(id),
    CONSTRAINT inv_blanket_release_stock_qty_check CHECK (quantity_released > 0)
);

COMMENT ON TABLE public.inv_blanket_release_stock IS 'Links blanket releases to actual stock deductions with validation';

-- ============================================================================
-- SECTION 10: INDEXES FOR PERFORMANCE
-- ============================================================================

-- Warehouse indexes
CREATE INDEX IF NOT EXISTS idx_inv_warehouses_type ON public.inv_warehouses(warehouse_type_id);
CREATE INDEX IF NOT EXISTS idx_inv_warehouses_country ON public.inv_warehouses(country_code);
CREATE INDEX IF NOT EXISTS idx_inv_warehouses_active ON public.inv_warehouses(is_active) WHERE is_active = true;

-- Warehouse stock indexes
CREATE INDEX IF NOT EXISTS idx_inv_warehouse_stock_wh ON public.inv_warehouse_stock(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_warehouse_stock_item ON public.inv_warehouse_stock(item_code);
CREATE INDEX IF NOT EXISTS idx_inv_warehouse_stock_lot ON public.inv_warehouse_stock(lot_number) WHERE lot_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_warehouse_stock_avail ON public.inv_warehouse_stock(warehouse_id, item_code) 
    WHERE quantity_available > 0;

-- Movement indexes
CREATE INDEX IF NOT EXISTS idx_inv_movement_headers_status ON public.inv_movement_headers(status);
CREATE INDEX IF NOT EXISTS idx_inv_movement_headers_date ON public.inv_movement_headers(movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movement_headers_source ON public.inv_movement_headers(source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_movement_headers_dest ON public.inv_movement_headers(destination_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_movement_headers_approval ON public.inv_movement_headers(approval_status) 
    WHERE approval_status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_inv_movement_lines_header ON public.inv_movement_lines(header_id);
CREATE INDEX IF NOT EXISTS idx_inv_movement_lines_item ON public.inv_movement_lines(item_code);

-- Ledger indexes (critical for reporting)
CREATE INDEX IF NOT EXISTS idx_inv_stock_ledger_wh_item ON public.inv_stock_ledger(warehouse_id, item_code);
CREATE INDEX IF NOT EXISTS idx_inv_stock_ledger_date ON public.inv_stock_ledger(ledger_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_stock_ledger_txn ON public.inv_stock_ledger(transaction_type);
CREATE INDEX IF NOT EXISTS idx_inv_stock_ledger_ref ON public.inv_stock_ledger(reference_type, reference_id);

-- Approval indexes
CREATE INDEX IF NOT EXISTS idx_inv_approvals_entity ON public.inv_approvals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_inv_approvals_pending ON public.inv_approvals(status) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_inv_approvals_approver ON public.inv_approvals(approver_user_id);

-- ============================================================================
-- SECTION 11: TRIGGERS FOR DATA INTEGRITY
-- ============================================================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION inv_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all inventory tables
DROP TRIGGER IF EXISTS trigger_inv_warehouse_types_updated ON public.inv_warehouse_types;
CREATE TRIGGER trigger_inv_warehouse_types_updated BEFORE UPDATE ON public.inv_warehouse_types
    FOR EACH ROW EXECUTE FUNCTION inv_update_updated_at();

DROP TRIGGER IF EXISTS trigger_inv_warehouses_updated ON public.inv_warehouses;
CREATE TRIGGER trigger_inv_warehouses_updated BEFORE UPDATE ON public.inv_warehouses
    FOR EACH ROW EXECUTE FUNCTION inv_update_updated_at();

DROP TRIGGER IF EXISTS trigger_inv_warehouse_stock_updated ON public.inv_warehouse_stock;
CREATE TRIGGER trigger_inv_warehouse_stock_updated BEFORE UPDATE ON public.inv_warehouse_stock
    FOR EACH ROW EXECUTE FUNCTION inv_update_updated_at();

DROP TRIGGER IF EXISTS trigger_inv_movement_headers_updated ON public.inv_movement_headers;
CREATE TRIGGER trigger_inv_movement_headers_updated BEFORE UPDATE ON public.inv_movement_headers
    FOR EACH ROW EXECUTE FUNCTION inv_update_updated_at();

DROP TRIGGER IF EXISTS trigger_inv_movement_lines_updated ON public.inv_movement_lines;
CREATE TRIGGER trigger_inv_movement_lines_updated BEFORE UPDATE ON public.inv_movement_lines
    FOR EACH ROW EXECUTE FUNCTION inv_update_updated_at();

-- Optimistic Concurrency Control
CREATE OR REPLACE FUNCTION inv_increment_row_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.row_version = OLD.row_version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_inv_warehouse_stock_version ON public.inv_warehouse_stock;
CREATE TRIGGER trigger_inv_warehouse_stock_version BEFORE UPDATE ON public.inv_warehouse_stock
    FOR EACH ROW EXECUTE FUNCTION inv_increment_row_version();

-- Prevent negative stock
CREATE OR REPLACE FUNCTION inv_check_stock_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.quantity_on_hand < 0 THEN
        RAISE EXCEPTION 'Stock quantity cannot be negative. Item: %, Warehouse: %, Attempted: %',
            NEW.item_code, NEW.warehouse_id, NEW.quantity_on_hand;
    END IF;
    IF NEW.quantity_available < 0 THEN
        RAISE EXCEPTION 'Available stock cannot be negative. Item: %, Warehouse: %',
            NEW.item_code, NEW.warehouse_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_inv_warehouse_stock_check ON public.inv_warehouse_stock;
CREATE TRIGGER trigger_inv_warehouse_stock_check BEFORE INSERT OR UPDATE ON public.inv_warehouse_stock
    FOR EACH ROW EXECUTE FUNCTION inv_check_stock_balance();

-- ============================================================================
-- SECTION 12: STOCK MANAGEMENT FUNCTIONS
-- ============================================================================

-- Validate stock availability for blanket release
CREATE OR REPLACE FUNCTION inv_validate_stock_for_release(
    p_warehouse_id uuid,
    p_item_code character varying,
    p_quantity integer,
    p_lot_number character varying DEFAULT NULL
)
RETURNS boolean AS $$
DECLARE
    v_available integer;
BEGIN
    SELECT COALESCE(SUM(quantity_available), 0) INTO v_available
    FROM public.inv_warehouse_stock
    WHERE warehouse_id = p_warehouse_id
      AND item_code = p_item_code
      AND (p_lot_number IS NULL OR lot_number = p_lot_number)
      AND is_active = true;
    
    RETURN v_available >= p_quantity;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Execute stock out for blanket release (transactional)
CREATE OR REPLACE FUNCTION inv_execute_blanket_release(
    p_release_id uuid,
    p_warehouse_id uuid,
    p_item_code character varying,
    p_quantity integer,
    p_lot_number character varying DEFAULT NULL,
    p_user_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
    v_stock_id uuid;
    v_current_qty integer;
    v_new_qty integer;
    v_ledger_id uuid;
    v_release_stock_id uuid;
BEGIN
    -- Validate stock availability
    IF NOT inv_validate_stock_for_release(p_warehouse_id, p_item_code, p_quantity, p_lot_number) THEN
        RAISE EXCEPTION 'Insufficient stock for release. Item: %, Requested: %', p_item_code, p_quantity;
    END IF;
    
    -- Lock and get stock record
    SELECT id, quantity_on_hand INTO v_stock_id, v_current_qty
    FROM public.inv_warehouse_stock
    WHERE warehouse_id = p_warehouse_id
      AND item_code = p_item_code
      AND (p_lot_number IS NULL OR lot_number = p_lot_number)
      AND is_active = true
    ORDER BY COALESCE(expiry_date, '2099-12-31') ASC
    LIMIT 1
    FOR UPDATE;
    
    v_new_qty := v_current_qty - p_quantity;
    
    -- Update stock
    UPDATE public.inv_warehouse_stock
    SET quantity_on_hand = v_new_qty,
        last_issue_date = now(),
        updated_by = p_user_id
    WHERE id = v_stock_id;
    
    -- Create ledger entry
    INSERT INTO public.inv_stock_ledger (
        warehouse_id, item_code, lot_number, transaction_type,
        quantity_change, quantity_before, quantity_after,
        reference_type, reference_id, created_by
    ) VALUES (
        p_warehouse_id, p_item_code, p_lot_number, 'BLANKET_RELEASE',
        -p_quantity, v_current_qty, v_new_qty,
        'BLANKET_RELEASE', p_release_id, p_user_id
    )
    RETURNING id INTO v_ledger_id;
    
    -- Create release stock record
    INSERT INTO public.inv_blanket_release_stock (
        release_id, warehouse_id, item_code, lot_number,
        quantity_released, stock_ledger_id, release_status,
        validated_at, validated_by, released_at, released_by, created_by
    ) VALUES (
        p_release_id, p_warehouse_id, p_item_code, p_lot_number,
        p_quantity, v_ledger_id, 'RELEASED',
        now(), p_user_id, now(), p_user_id, p_user_id
    )
    RETURNING id INTO v_release_stock_id;
    
    RETURN v_release_stock_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Generate movement number
CREATE OR REPLACE FUNCTION inv_generate_movement_number()
RETURNS character varying AS $$
DECLARE
    v_prefix character varying := 'MOV';
    v_year character varying := to_char(CURRENT_DATE, 'YY');
    v_month character varying := to_char(CURRENT_DATE, 'MM');
    v_seq integer;
    v_number character varying;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(movement_number FROM 8) AS integer)), 0) + 1
    INTO v_seq
    FROM public.inv_movement_headers
    WHERE movement_number LIKE v_prefix || v_year || v_month || '%';
    
    v_number := v_prefix || v_year || v_month || LPAD(v_seq::text, 5, '0');
    RETURN v_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SECTION 13: VIEWS FOR REPORTING
-- ============================================================================

-- Consolidated warehouse stock view
CREATE OR REPLACE VIEW public.vw_inv_warehouse_stock_summary AS
SELECT 
    ws.warehouse_id,
    w.warehouse_code,
    w.warehouse_name,
    wt.type_name AS warehouse_type,
    ws.item_code,
    i.item_name,
    SUM(ws.quantity_on_hand) AS total_on_hand,
    SUM(ws.quantity_allocated) AS total_allocated,
    SUM(ws.quantity_reserved) AS total_reserved,
    SUM(ws.quantity_available) AS total_available,
    COUNT(DISTINCT ws.lot_number) AS lot_count
FROM public.inv_warehouse_stock ws
JOIN public.inv_warehouses w ON ws.warehouse_id = w.id
JOIN public.inv_warehouse_types wt ON w.warehouse_type_id = wt.id
JOIN public.items i ON ws.item_code = i.item_code
WHERE ws.is_active = true AND w.is_active = true
GROUP BY ws.warehouse_id, w.warehouse_code, w.warehouse_name, 
         wt.type_name, ws.item_code, i.item_name;

-- Pending approvals view
CREATE OR REPLACE VIEW public.vw_inv_pending_approvals AS
SELECT 
    a.id AS approval_id,
    a.entity_type,
    a.entity_id,
    mh.movement_number,
    mh.movement_type,
    mh.movement_date,
    sw.warehouse_name AS source_warehouse,
    dw.warehouse_name AS destination_warehouse,
    a.approval_level,
    a.approver_role,
    a.due_date,
    p.full_name AS requested_by_name,
    mh.requested_at
FROM public.inv_approvals a
JOIN public.inv_movement_headers mh ON a.entity_type = 'MOVEMENT' AND a.entity_id = mh.id
LEFT JOIN public.inv_warehouses sw ON mh.source_warehouse_id = sw.id
LEFT JOIN public.inv_warehouses dw ON mh.destination_warehouse_id = dw.id
LEFT JOIN public.profiles p ON mh.requested_by = p.id
WHERE a.status = 'PENDING';

-- ============================================================================
-- SECTION 14: ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.inv_warehouse_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_warehouse_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_movement_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_movement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_reference_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_blanket_release_stock ENABLE ROW LEVEL SECURITY;

-- RLS Policies (authenticated users can read, write controlled by application)
CREATE POLICY "Auth read inv_warehouse_types" ON public.inv_warehouse_types 
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth modify inv_warehouse_types" ON public.inv_warehouse_types 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth read inv_warehouses" ON public.inv_warehouses 
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth modify inv_warehouses" ON public.inv_warehouses 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth read inv_warehouse_stock" ON public.inv_warehouse_stock 
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth modify inv_warehouse_stock" ON public.inv_warehouse_stock 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth read inv_movement_headers" ON public.inv_movement_headers 
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth modify inv_movement_headers" ON public.inv_movement_headers 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth read inv_movement_lines" ON public.inv_movement_lines 
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth modify inv_movement_lines" ON public.inv_movement_lines 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth read inv_stock_ledger" ON public.inv_stock_ledger 
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert inv_stock_ledger" ON public.inv_stock_ledger 
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Auth read inv_approvals" ON public.inv_approvals 
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth modify inv_approvals" ON public.inv_approvals 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth read inv_reference_documents" ON public.inv_reference_documents 
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth modify inv_reference_documents" ON public.inv_reference_documents 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth read inv_reason_codes" ON public.inv_reason_codes 
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth modify inv_reason_codes" ON public.inv_reason_codes 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth read inv_blanket_release_stock" ON public.inv_blanket_release_stock 
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth modify inv_blanket_release_stock" ON public.inv_blanket_release_stock 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- SECTION 15: SEED DATA
-- ============================================================================

-- Default Warehouse Types
INSERT INTO public.inv_warehouse_types (type_code, type_name, category, description, is_transit_point, is_production_site, can_ship_external, sort_order)
VALUES 
    ('PROD', 'Production Warehouse', 'PRODUCTION', 'Manufacturing and production facilities', false, true, false, 1),
    ('INTRANS', 'In-Transit Warehouse', 'IN_TRANSIT', 'Intermediate transit storage', true, false, false, 2),
    ('SNV', 'S&V Warehouse', 'SNV', 'Shipping and verification warehouse', false, false, true, 3),
    ('USTRANS', 'US Transit Warehouse', 'US_TRANSIT', 'US-based transit warehouse', true, false, true, 4),
    ('DIST', 'Distribution Center', 'DISTRIBUTION', 'Regional distribution center', false, false, true, 5),
    ('RETURN', 'Returns Warehouse', 'RETURNS', 'Customer returns processing', false, false, false, 6),
    ('QUAR', 'Quarantine Warehouse', 'QUARANTINE', 'Quality hold and inspection', false, false, false, 7)
ON CONFLICT (type_code) DO NOTHING;

-- Default Reason Codes
INSERT INTO public.inv_reason_codes (reason_code, reason_category, description, requires_approval)
VALUES 
    ('PROD_RECV', 'RECEIPT', 'Production receipt', false),
    ('PURCH_RECV', 'RECEIPT', 'Purchase order receipt', false),
    ('RETURN_RECV', 'RECEIPT', 'Customer return receipt', true),
    ('SALES_OUT', 'ISSUE', 'Sales order shipment', false),
    ('PROD_ISSUE', 'ISSUE', 'Production consumption', false),
    ('TRANS_OUT', 'TRANSFER', 'Inter-warehouse transfer out', false),
    ('TRANS_IN', 'TRANSFER', 'Inter-warehouse transfer in', false),
    ('CYCLE_CNT', 'ADJUSTMENT', 'Cycle count adjustment', true),
    ('DAMAGE', 'ADJUSTMENT', 'Damage write-off', true),
    ('SCRAP', 'ADJUSTMENT', 'Scrap write-off', true),
    ('QC_HOLD', 'ADJUSTMENT', 'Quality control hold', true),
    ('QC_RELEASE', 'ADJUSTMENT', 'Quality control release', true)
ON CONFLICT (reason_code) DO NOTHING;

-- ============================================================================
-- END OF INVENTORY EXTENSION
-- ============================================================================
