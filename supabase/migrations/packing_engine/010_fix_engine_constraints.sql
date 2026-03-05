-- ============================================================================
-- 010: Fix pack_containers & pack_pallets to work with packing_specifications
-- ============================================================================
-- The contract_config_id was NOT NULL referencing pack_contract_configs,
-- but we now source outer/inner box qty from packing_specifications.
-- Make contract_config_id nullable so containers/pallets can be created
-- without a pack_contract_configs record.

-- 1. Make contract_config_id nullable on pack_containers
ALTER TABLE pack_containers
  ALTER COLUMN contract_config_id DROP NOT NULL;

-- 2. Make contract_config_id nullable on pack_pallets
ALTER TABLE pack_pallets
  ALTER COLUMN contract_config_id DROP NOT NULL;

-- 3. Add packing_spec_id to pack_containers for direct reference
ALTER TABLE pack_containers
  ADD COLUMN IF NOT EXISTS packing_spec_id UUID REFERENCES packing_specifications(id);

-- 4. Add packing_spec_id to pack_pallets for direct reference
ALTER TABLE pack_pallets
  ADD COLUMN IF NOT EXISTS packing_spec_id UUID REFERENCES packing_specifications(id);

-- 5. Make assigned_by nullable on pack_pallet_containers
-- (The engine auto-assigns containers to pallets without explicit user assignment)
ALTER TABLE pack_pallet_containers
  ALTER COLUMN assigned_by DROP NOT NULL;

-- 6. Remove colour column from items if it was added
-- (User decided colour is not needed in item master)
ALTER TABLE items DROP COLUMN IF EXISTS colour;

COMMENT ON COLUMN pack_containers.packing_spec_id IS 'Reference to packing_specifications for outer/inner box qty';
COMMENT ON COLUMN pack_pallets.packing_spec_id IS 'Reference to packing_specifications for target qty calculation';
