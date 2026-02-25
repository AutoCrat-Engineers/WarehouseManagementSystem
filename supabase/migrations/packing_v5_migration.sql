-- ============================================================================
-- PACKING v5 — Migration Script
-- Run this ONCE against your Supabase database to support:
--   1) Per-box Packing IDs (PKG-XXXXXXXX stored in packing_boxes)
--   2) Stock transfer tracking on packing_requests and packing_boxes
--   3) New status values: PARTIALLY_TRANSFERRED
-- ============================================================================

-- Add packing_id column to packing_boxes (stores PKG-XXXXXXXX per box)
ALTER TABLE packing_boxes ADD COLUMN IF NOT EXISTS packing_id TEXT;

-- Add transfer tracking columns to packing_boxes
ALTER TABLE packing_boxes ADD COLUMN IF NOT EXISTS is_transferred BOOLEAN DEFAULT FALSE;
ALTER TABLE packing_boxes ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;

-- Add transfer tracking columns to packing_requests
ALTER TABLE packing_requests ADD COLUMN IF NOT EXISTS transferred_qty INTEGER DEFAULT 0;
ALTER TABLE packing_requests ADD COLUMN IF NOT EXISTS last_transfer_at TIMESTAMPTZ;

-- Add started_at if it doesn't already exist
ALTER TABLE packing_requests ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- Update status check constraint to include new values (if constraint exists)
-- Note: If there's a check constraint on status, you may need to drop and recreate it
-- to allow 'PARTIALLY_TRANSFERRED' as a valid value.
-- Example (adjust constraint name to match your DB):
-- ALTER TABLE packing_requests DROP CONSTRAINT IF EXISTS packing_requests_status_check;
-- ALTER TABLE packing_requests ADD CONSTRAINT packing_requests_status_check
--   CHECK (status IN ('APPROVED', 'REJECTED', 'PACKING_IN_PROGRESS', 'PARTIALLY_TRANSFERRED', 'COMPLETED'));

-- ============================================================================
-- VERIFY: Run these queries to confirm the migration worked
-- ============================================================================
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'packing_boxes'
--   AND column_name IN ('packing_id', 'is_transferred', 'transferred_at');
--
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'packing_requests'
--   AND column_name IN ('transferred_qty', 'last_transfer_at', 'started_at');
