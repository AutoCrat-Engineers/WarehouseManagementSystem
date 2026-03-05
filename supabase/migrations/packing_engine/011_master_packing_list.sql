-- ============================================================================
-- 011 — MASTER PACKING LIST DATA + PALLET DISPATCH DETAILS
-- Enterprise-grade packing list header data for print layout generation.
-- Stores exporter, consignee, buyer, shipping, and per-pallet invoice +
-- gross weight details collected from dispatch team before printing.
--
-- Designed for 100M+ record scalability:
--   - UUID primary keys (partition-safe)
--   - Composite indexes for high-frequency lookups
--   - Denormalized totals for O(1) aggregation
--   - JSONB metadata for extensibility without schema migration
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: pack_packing_list_data
-- Stores the header/shipping/consignee data for the packing list print.
-- One row per packing list. These are the "editable" fields that the
-- dispatch team fills in before generating the print layout.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pack_packing_list_data (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    packing_list_id             UUID NOT NULL REFERENCES pack_packing_lists(id) ON DELETE CASCADE,

    -- ─── EXPORTER (default: Autocrat Engineers) ───
    exporter_name               VARCHAR NOT NULL DEFAULT 'AUTOCRAT ENGINEERS',
    exporter_address            TEXT NOT NULL DEFAULT 'NO. 21 & 22, Export Promotion Industrial Park, Phase - I, Whitefield, Bangalore-560066, KARNATAKA - INDIA',
    exporter_phone              VARCHAR NOT NULL DEFAULT 'PH 91 80 43330127',
    exporter_email              VARCHAR NOT NULL DEFAULT 'dispatch@autocratengineers.in',
    exporter_gstin              VARCHAR NOT NULL DEFAULT '29ABLPK6831H1ZB',
    exporter_pan                VARCHAR DEFAULT 'ABLPK6831H',
    exporter_ref                VARCHAR DEFAULT '-NIL-',
    exporter_iec_code           VARCHAR DEFAULT '0702002747',
    exporter_ad_code            VARCHAR DEFAULT '6361504-8400009',

    -- ─── INVOICE / PO (dispatch team enters these) ───
    invoice_number              VARCHAR,
    invoice_date                DATE,
    purchase_order_number       VARCHAR,
    purchase_order_date         DATE,
    vendor_number               VARCHAR,

    -- ─── CONSIGNEE ───
    consignee_name              VARCHAR,
    consignee_address           TEXT,
    consignee_phone             VARCHAR,

    -- ─── BUYER ───
    buyer_name                  VARCHAR,
    buyer_phone                 VARCHAR,
    buyer_email                 VARCHAR,

    -- ─── BILL TO ───
    bill_to_name                VARCHAR,
    bill_to_address             TEXT,

    -- ─── SHIPPING ───
    ship_via                    VARCHAR,
    pre_carriage_by             VARCHAR DEFAULT 'Road',
    place_of_receipt            VARCHAR DEFAULT 'BANGALORE',
    country_of_origin           VARCHAR NOT NULL DEFAULT 'INDIA',
    country_of_destination      VARCHAR,
    vessel_flight_no            VARCHAR,
    port_of_loading             VARCHAR DEFAULT 'BANGALORE, ICD',
    terms_of_delivery           VARCHAR DEFAULT 'DDP',
    payment_terms               VARCHAR DEFAULT 'Net-30',
    port_of_discharge           VARCHAR,
    final_destination           VARCHAR,
    mode_of_transport           VARCHAR DEFAULT 'Sea',

    -- ─── ITEM DESCRIPTION HEADER ───
    item_description_header     VARCHAR DEFAULT 'PRECISION MACHINED COMPONENTS',
    item_description_sub_header VARCHAR DEFAULT '(OTHERS FUELING COMPONENTS)',
    batch_number                VARCHAR,

    -- ─── METADATA ───
    notes                       TEXT,
    extra_data                  JSONB DEFAULT '{}',
    is_finalized                BOOLEAN NOT NULL DEFAULT FALSE,

    -- ─── AUDIT ───
    created_by                  UUID NOT NULL REFERENCES profiles(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                  UUID REFERENCES profiles(id),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One data record per packing list
    CONSTRAINT uq_pl_data UNIQUE (packing_list_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: pack_packing_list_pallet_details
-- Per-pallet dispatch details: invoice number, gross weight, PO number,
-- carton number, HTS code, part revision, pallet dimensions, etc.
-- Collected from dispatch team before generating the final print.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pack_packing_list_pallet_details (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    packing_list_data_id        UUID NOT NULL REFERENCES pack_packing_list_data(id) ON DELETE CASCADE,
    packing_list_id             UUID NOT NULL REFERENCES pack_packing_lists(id) ON DELETE CASCADE,
    pallet_id                   UUID NOT NULL REFERENCES pack_pallets(id),

    -- ─── PALLET IDENTIFICATION ───
    pallet_number               VARCHAR NOT NULL,
    carton_number               VARCHAR,
    batch_number                VARCHAR,

    -- ─── ITEM DETAILS (denormalized for print performance) ───
    item_code                   VARCHAR NOT NULL,
    item_name                   VARCHAR,
    part_number                 VARCHAR,
    master_serial_no            VARCHAR,
    hts_code                    VARCHAR,
    part_revision               VARCHAR,

    -- ─── QUANTITIES ───
    num_pallets                 INTEGER NOT NULL DEFAULT 1,
    qty_per_pallet              INTEGER NOT NULL DEFAULT 0,
    total_containers            INTEGER NOT NULL DEFAULT 0,

    -- ─── DIMENSIONS (CMs) ───
    pallet_length_cm            NUMERIC(10,2),
    pallet_width_cm             NUMERIC(10,2),
    pallet_height_cm            NUMERIC(10,2),

    -- ─── WEIGHTS (KGs) ───
    net_weight_kg               NUMERIC(12,4) NOT NULL DEFAULT 0,
    gross_weight_kg             NUMERIC(12,4) NOT NULL DEFAULT 0,

    -- ─── INVOICE / PO (per-pallet overrides) ───
    invoice_number              VARCHAR,
    po_number                   VARCHAR,

    -- ─── SEQUENCE ───
    line_number                 INTEGER NOT NULL DEFAULT 1,

    -- ─── METADATA ───
    extra_data                  JSONB DEFAULT '{}',

    -- ─── AUDIT ───
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Each pallet appears once per packing list data
    CONSTRAINT uq_pld_pallet UNIQUE (packing_list_data_id, pallet_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES for 100M+ record performance
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ppld_pl_id ON pack_packing_list_data(packing_list_id);
CREATE INDEX IF NOT EXISTS idx_ppld_created_at ON pack_packing_list_data(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppld_invoice ON pack_packing_list_data(invoice_number) WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pplpd_data_id ON pack_packing_list_pallet_details(packing_list_data_id);
CREATE INDEX IF NOT EXISTS idx_pplpd_pl_id ON pack_packing_list_pallet_details(packing_list_id);
CREATE INDEX IF NOT EXISTS idx_pplpd_pallet ON pack_packing_list_pallet_details(pallet_id);
CREATE INDEX IF NOT EXISTS idx_pplpd_item ON pack_packing_list_pallet_details(item_code);
CREATE INDEX IF NOT EXISTS idx_pplpd_created ON pack_packing_list_pallet_details(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS (idempotent — safe to re-run)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pack_packing_list_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ppld_select ON pack_packing_list_data;
DROP POLICY IF EXISTS ppld_insert ON pack_packing_list_data;
DROP POLICY IF EXISTS ppld_update ON pack_packing_list_data;
DROP POLICY IF EXISTS ppld_delete ON pack_packing_list_data;
CREATE POLICY ppld_select ON pack_packing_list_data FOR SELECT TO authenticated USING (true);
CREATE POLICY ppld_insert ON pack_packing_list_data FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ppld_update ON pack_packing_list_data FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY ppld_delete ON pack_packing_list_data FOR DELETE TO authenticated USING (true);

ALTER TABLE pack_packing_list_pallet_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pplpd_select ON pack_packing_list_pallet_details;
DROP POLICY IF EXISTS pplpd_insert ON pack_packing_list_pallet_details;
DROP POLICY IF EXISTS pplpd_update ON pack_packing_list_pallet_details;
DROP POLICY IF EXISTS pplpd_delete ON pack_packing_list_pallet_details;
CREATE POLICY pplpd_select ON pack_packing_list_pallet_details FOR SELECT TO authenticated USING (true);
CREATE POLICY pplpd_insert ON pack_packing_list_pallet_details FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pplpd_update ON pack_packing_list_pallet_details FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pplpd_delete ON pack_packing_list_pallet_details FOR DELETE TO authenticated USING (true);
