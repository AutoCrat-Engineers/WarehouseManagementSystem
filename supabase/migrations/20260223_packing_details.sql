-- ============================================================================
-- PACKING SPECIFICATIONS TABLE — Migration
-- Stores per-item packing box dimensions and weights.
-- Strictly tied to Item Master via FK with CASCADE DELETE.
-- All lengths stored in mm, all weights stored in kg.
-- ============================================================================

-- 1. Create the table
CREATE TABLE IF NOT EXISTS packing_specifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  item_code       TEXT NOT NULL,    -- denormalized for quick lookups
  -- Inner Box
  inner_box_length_mm   NUMERIC(10,2) NOT NULL DEFAULT 0,
  inner_box_width_mm    NUMERIC(10,2) NOT NULL DEFAULT 0,
  inner_box_height_mm   NUMERIC(10,2) NOT NULL DEFAULT 0,
  inner_box_quantity    INTEGER NOT NULL DEFAULT 0,
  inner_box_net_weight_kg NUMERIC(10,4) NOT NULL DEFAULT 0,
  -- Outer Box
  outer_box_length_mm   NUMERIC(10,2) NOT NULL DEFAULT 0,
  outer_box_width_mm    NUMERIC(10,2) NOT NULL DEFAULT 0,
  outer_box_height_mm   NUMERIC(10,2) NOT NULL DEFAULT 0,
  outer_box_gross_weight_kg NUMERIC(10,4) NOT NULL DEFAULT 0,
  -- Status (auto-synced from Item Master)
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Constraints
  CONSTRAINT uq_packing_spec_item UNIQUE(item_id)
);

-- 2. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_packing_spec_item_code ON packing_specifications(item_code);

-- 3. Auto-sync status from items table whenever items.is_active changes
CREATE OR REPLACE FUNCTION sync_packing_status()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    UPDATE packing_specifications
    SET is_active = NEW.is_active,
        updated_at = now()
    WHERE item_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_packing_status ON items;
CREATE TRIGGER trg_sync_packing_status
  AFTER UPDATE ON items
  FOR EACH ROW
  EXECUTE FUNCTION sync_packing_status();

-- 4. Enable RLS
ALTER TABLE packing_specifications ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to SELECT
CREATE POLICY packing_spec_select ON packing_specifications
  FOR SELECT TO authenticated USING (true);

-- Allow authenticated users to INSERT
CREATE POLICY packing_spec_insert ON packing_specifications
  FOR INSERT TO authenticated WITH CHECK (true);

-- Allow authenticated users to UPDATE
CREATE POLICY packing_spec_update ON packing_specifications
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Allow authenticated users to DELETE
CREATE POLICY packing_spec_delete ON packing_specifications
  FOR DELETE TO authenticated USING (true);
