-- ============================================================================
-- ADD TEXT COLUMNS TO inv_movement_headers
-- Run this in Supabase SQL Editor (safe to run multiple times)
-- ============================================================================

ALTER TABLE inv_movement_headers
  ADD COLUMN IF NOT EXISTS reason_category varchar,
  ADD COLUMN IF NOT EXISTS reference_type varchar,
  ADD COLUMN IF NOT EXISTS reference_id varchar;

-- ============================================================================
-- DONE
-- ============================================================================
