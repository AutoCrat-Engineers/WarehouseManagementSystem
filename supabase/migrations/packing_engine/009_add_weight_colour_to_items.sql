-- ============================================================================
-- 009: Add weight column to items table
-- ============================================================================
-- The items table needs a weight field for packing documentation
-- (packing lists, invoices, customs declarations, sticker printing).
--
-- NOTE: The frontend already references 'weight' in the Item interface.
--       We add it here if it doesn't exist yet.

-- Add weight column (numeric, nullable — maps to frontend's 'weight' field)
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS weight NUMERIC DEFAULT NULL;

-- Comments for documentation
COMMENT ON COLUMN public.items.weight IS 'Unit weight of the item in grams';
