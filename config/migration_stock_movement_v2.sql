-- ============================================================================
-- STOCK MOVEMENT V2 — APPROVAL WORKFLOW MIGRATION
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. REASON CODES TABLE (with category + description)
CREATE TABLE IF NOT EXISTS inv_reason_codes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category varchar NOT NULL,
  description text,
  reason_type varchar NOT NULL CHECK (reason_type IN ('STOCK_IN', 'REJECTION', 'ALL')),
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (category)
);

-- Seed reason codes (category driven)
INSERT INTO inv_reason_codes (category, description, reason_type, sort_order) VALUES
  ('PRODUCTION_COMPLETE',       'Production batch completed and quality verified',          'STOCK_IN',   1),
  ('PRODUCTION_EXCESS',         'Excess production from batch run',                         'STOCK_IN',   2),
  ('INTER_WAREHOUSE_TRANSFER',  'Stock received from inter-warehouse transfer',             'STOCK_IN',   3),
  ('DISPATCH_FORWARD',          'Dispatched to next warehouse in forward flow',             'STOCK_IN',   4),
  ('CUSTOMER_RETURN_DEFECT',    'Customer return due to product defect',                    'REJECTION',  5),
  ('CUSTOMER_RETURN_WRONG_ITEM','Customer return — wrong item shipped',                     'REJECTION',  6),
  ('CUSTOMER_RETURN_EXCESS',    'Customer return of excess quantity',                       'REJECTION',  7),
  ('QC_REJECTION',              'Quality control rejection — return to source',             'REJECTION',  8),
  ('RETURN_TO_PRODUCTION',      'Return to production floor for rework',                    'REJECTION',  9),
  ('STOCK_ADJUSTMENT',          'Stock adjustment based on physical count',                 'ALL',       10),
  ('OTHER',                     'Other reason — please specify in notes',                   'ALL',       11)
ON CONFLICT (category) DO NOTHING;

-- 2. REFERENCE DOCUMENTS TABLE (kept for reference lookups, but Reference ID is user-typed)
CREATE TABLE IF NOT EXISTS inv_reference_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reference_type varchar NOT NULL CHECK (reference_type IN (
    'DELIVERY_NOTE', 'RETURN_NOTE', 'PRODUCTION_ORDER', 'TRANSFER_ORDER', 'ADJUSTMENT_MEMO'
  )),
  reference_number varchar NOT NULL,
  description text,
  status varchar DEFAULT 'ACTIVE',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  created_by uuid
);

-- Seed sample reference documents (optional — Reference ID is now user-typed)
INSERT INTO inv_reference_documents (reference_type, reference_number, description) VALUES
  ('PRODUCTION_ORDER', 'PO-2026-001', 'Production Order — Batch A Feb 2026'),
  ('PRODUCTION_ORDER', 'PO-2026-002', 'Production Order — Batch B Feb 2026'),
  ('DELIVERY_NOTE',    'DN-2026-001', 'Delivery from production floor'),
  ('TRANSFER_ORDER',   'TO-2026-001', 'Transfer PW to In-Transit'),
  ('TRANSFER_ORDER',   'TO-2026-002', 'Transfer In-Transit to S&V'),
  ('RETURN_NOTE',      'RN-2026-001', 'Customer return — defective batch'),
  ('ADJUSTMENT_MEMO',  'AM-2026-001', 'Physical count adjustment Q1')
ON CONFLICT DO NOTHING;

-- 3. MOVEMENT APPROVALS AUDIT TABLE
CREATE TABLE IF NOT EXISTS inv_movement_approvals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  movement_header_id uuid NOT NULL REFERENCES inv_movement_headers(id) ON DELETE CASCADE,
  action varchar NOT NULL CHECK (action IN ('APPROVED','PARTIALLY_APPROVED','REJECTED','CANCELLED')),
  requested_quantity numeric NOT NULL,
  approved_quantity numeric DEFAULT 0,
  rejected_quantity numeric DEFAULT 0,
  supervisor_note text,
  approved_by uuid,
  created_at timestamptz DEFAULT now()
);

-- 4. ALTER inv_movement_headers — add new columns
ALTER TABLE inv_movement_headers
  ADD COLUMN IF NOT EXISTS requested_quantity numeric,
  ADD COLUMN IF NOT EXISTS approved_quantity numeric,
  ADD COLUMN IF NOT EXISTS rejected_quantity numeric,
  ADD COLUMN IF NOT EXISTS supervisor_note text,
  ADD COLUMN IF NOT EXISTS reference_type varchar,
  ADD COLUMN IF NOT EXISTS reference_id varchar,
  ADD COLUMN IF NOT EXISTS reason_category varchar;

-- (Legacy columns — keep if they already exist, no new FK needed)
-- If you previously ran the old migration with reason_code_id / reference_document_id,
-- they will be ignored. The new code uses reason_category and reference_id (text) instead.

-- 5. RLS POLICIES
ALTER TABLE inv_reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_reference_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_movement_approvals ENABLE ROW LEVEL SECURITY;

-- Reason codes: read for all authenticated
DO $$ BEGIN
  CREATE POLICY "reason_codes_select" ON inv_reason_codes FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Reference documents: read + insert for authenticated
DO $$ BEGIN
  CREATE POLICY "ref_docs_select" ON inv_reference_documents FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "ref_docs_insert" ON inv_reference_documents FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Movement approvals: read + insert for authenticated
DO $$ BEGIN
  CREATE POLICY "approvals_select" ON inv_movement_approvals FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "approvals_insert" ON inv_movement_approvals FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- DONE — Run this script in Supabase SQL Editor before using the new features
-- ============================================================================
