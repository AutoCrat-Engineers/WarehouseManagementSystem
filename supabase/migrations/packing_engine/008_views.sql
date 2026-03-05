-- ============================================================================
-- 008 — VIEWS + AGGREGATION FUNCTION
-- Operator instructions, full traceability, dispatch readiness
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────
-- VIEW: Operator Instruction Panel
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_pack_operator_instructions AS
SELECT
    p.id AS pallet_id,
    p.pallet_number,
    p.item_code,
    i.item_name,
    i.master_serial_no,
    c.contract_outer_qty,
    c.inner_box_qty,
    p.target_qty,
    p.current_qty,
    p.target_qty - p.current_qty AS remaining_qty,
    p.container_count,
    p.state,
    CASE
        WHEN p.state = 'ADJUSTMENT_REQUIRED' THEN
            FORMAT('Generate Adjustment Container of %s pcs', p.target_qty - p.current_qty)
        WHEN p.state = 'OPEN' THEN
            FORMAT('Add inner containers (%s pcs each)', c.inner_box_qty)
        WHEN p.state = 'FILLING' THEN
            FORMAT('Continue adding containers. %s / %s (%s%%)',
                p.current_qty, p.target_qty,
                ROUND(p.current_qty::NUMERIC / NULLIF(p.target_qty, 0) * 100))
        WHEN p.state = 'READY' THEN
            'Pallet COMPLETE — ready for dispatch selection'
        ELSE p.state
    END AS operator_instruction,
    p.sequence_number,
    p.created_at
FROM pack_pallets p
JOIN items i ON i.item_code = p.item_code
JOIN pack_contract_configs c ON c.id = p.contract_config_id
WHERE p.state NOT IN ('DISPATCHED', 'IN_TRANSIT', 'CANCELLED')
ORDER BY
    CASE p.state
        WHEN 'ADJUSTMENT_REQUIRED' THEN 1
        WHEN 'FILLING' THEN 2
        WHEN 'OPEN' THEN 3
        WHEN 'READY' THEN 4
        ELSE 5
    END,
    p.created_at;

-- ──────────────────────────────────────────────────────────────────────
-- VIEW: Full Backward Traceability
-- Invoice → Pallet → Container → Movement → Operator → Source
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_pack_full_trace AS
SELECT
    inv.invoice_number,
    inv.invoice_date,
    pl.packing_list_number,
    p.pallet_number,
    p.state AS pallet_state,
    p.target_qty AS pallet_target,
    p.current_qty AS pallet_actual,
    ct.container_number,
    ct.quantity AS container_qty,
    ct.container_type,
    ct.is_adjustment,
    ct.sticker_printed,
    ct.movement_number,
    ct.movement_header_id,
    op.full_name AS operator_name,
    op.employee_id AS operator_employee_id,
    ct.reference_doc_type,
    ct.reference_doc_number,
    ct.item_code,
    i.item_name,
    i.master_serial_no,
    i.part_number,
    ct.created_at AS container_created,
    p.ready_at AS pallet_ready,
    pl.confirmed_at AS packing_list_confirmed,
    inv.confirmed_at AS invoice_confirmed,
    pi.proforma_number,
    pi.stock_moved_at AS dispatch_timestamp
FROM pack_containers ct
JOIN items i ON i.item_code = ct.item_code
JOIN profiles op ON op.id = ct.created_by
LEFT JOIN pack_pallet_containers pc ON pc.container_id = ct.id
LEFT JOIN pack_pallets p ON p.id = pc.pallet_id
LEFT JOIN pack_packing_list_items pli ON pli.pallet_id = p.id
LEFT JOIN pack_packing_lists pl ON pl.id = pli.packing_list_id
LEFT JOIN pack_invoices inv ON inv.packing_list_id = pl.id
LEFT JOIN pack_proforma_invoice_items pii ON pii.invoice_id = inv.id
LEFT JOIN pack_proforma_invoices pi ON pi.id = pii.proforma_id
ORDER BY inv.invoice_number, p.pallet_number, pc.position_sequence;

-- ──────────────────────────────────────────────────────────────────────
-- VIEW: Dispatch Readiness Dashboard
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_pack_dispatch_readiness AS
SELECT
    cc.item_code,
    i.item_name,
    i.master_serial_no,
    cc.contract_outer_qty,
    cc.inner_box_qty,
    cc.customer_name,
    COUNT(*) FILTER (WHERE p.state = 'READY') AS ready_pallets,
    COUNT(*) FILTER (WHERE p.state IN ('OPEN','FILLING','ADJUSTMENT_REQUIRED')) AS partial_pallets,
    COUNT(*) FILTER (WHERE p.state = 'LOCKED') AS locked_pallets,
    COUNT(*) FILTER (WHERE p.state = 'DISPATCHED') AS dispatched_pallets,
    COALESCE(SUM(p.current_qty) FILTER (WHERE p.state = 'READY'), 0) AS ready_qty,
    COALESCE(SUM(p.current_qty) FILTER (WHERE p.state IN ('OPEN','FILLING','ADJUSTMENT_REQUIRED')), 0) AS partial_qty,
    COALESCE(SUM(p.container_count), 0) AS total_containers
FROM pack_contract_configs cc
JOIN items i ON i.item_code = cc.item_code
LEFT JOIN pack_pallets p ON p.contract_config_id = cc.id AND p.state != 'CANCELLED'
WHERE cc.is_active = TRUE
GROUP BY cc.item_code, i.item_name, i.master_serial_no, cc.contract_outer_qty, cc.inner_box_qty, cc.customer_name
ORDER BY ready_pallets DESC, cc.item_code;
