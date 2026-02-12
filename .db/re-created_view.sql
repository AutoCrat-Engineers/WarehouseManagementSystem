-- FIXED VIEW: Shows ALL items, even those with zero stock
-- Drop and recreate the view

DROP VIEW IF EXISTS public.vw_item_stock_dashboard CASCADE;
DROP VIEW IF EXISTS public.vw_item_stock_distribution CASCADE;

CREATE VIEW public.vw_item_stock_distribution AS
WITH
  warehouse_stock_pivot AS (
    SELECT
      i.item_code,
      i.item_name,
      i.part_number,
      i.master_serial_no,
      i.revision,
      i.uom,
      i.unit_price,
      i.standard_cost,
      
      -- PRODUCTION warehouse
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'PRODUCTION'::warehouse_category THEN ws.quantity_on_hand
          ELSE 0
        END
      ), 0) AS production_on_hand,
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'PRODUCTION'::warehouse_category THEN ws.quantity_available
          ELSE 0
        END
      ), 0) AS production_available,
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'PRODUCTION'::warehouse_category THEN ws.quantity_reserved
          ELSE 0
        END
      ), 0) AS production_reserved,
      
      -- IN_TRANSIT warehouse
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'IN_TRANSIT'::warehouse_category THEN ws.quantity_on_hand
          ELSE 0
        END
      ), 0) AS in_transit_qty,
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'IN_TRANSIT'::warehouse_category THEN ws.quantity_available
          ELSE 0
        END
      ), 0) AS in_transit_available,
      
      -- SNV warehouse
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'SNV'::warehouse_category THEN ws.quantity_on_hand
          ELSE 0
        END
      ), 0) AS snv_on_hand,
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'SNV'::warehouse_category THEN ws.quantity_available
          ELSE 0
        END
      ), 0) AS snv_available,
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'SNV'::warehouse_category THEN ws.quantity_reserved
          ELSE 0
        END
      ), 0) AS snv_reserved,
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'SNV'::warehouse_category THEN ws.quantity_allocated
          ELSE 0
        END
      ), 0) AS snv_allocated,
      
      -- US_TRANSIT warehouse
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'US_TRANSIT'::warehouse_category THEN ws.quantity_on_hand
          ELSE 0
        END
      ), 0) AS us_transit_on_hand,
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'US_TRANSIT'::warehouse_category THEN ws.quantity_available
          ELSE 0
        END
      ), 0) AS us_transit_available,
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'US_TRANSIT'::warehouse_category THEN ws.quantity_reserved
          ELSE 0
        END
      ), 0) AS us_transit_reserved,
      
      -- DISTRIBUTION warehouse
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'DISTRIBUTION'::warehouse_category THEN ws.quantity_on_hand
          ELSE 0
        END
      ), 0) AS distribution_on_hand,
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'DISTRIBUTION'::warehouse_category THEN ws.quantity_available
          ELSE 0
        END
      ), 0) AS distribution_available,
      
      -- QUARANTINE warehouse
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'QUARANTINE'::warehouse_category THEN ws.quantity_on_hand
          ELSE 0
        END
      ), 0) AS quarantine_qty,
      
      -- RETURNS warehouse
      COALESCE(SUM(
        CASE
          WHEN wt.category = 'RETURNS'::warehouse_category THEN ws.quantity_on_hand
          ELSE 0
        END
      ), 0) AS returns_qty,
      
      -- Totals
      COALESCE(SUM(ws.quantity_on_hand), 0) AS total_on_hand,
      COALESCE(SUM(ws.quantity_available), 0) AS total_available,
      COALESCE(SUM(ws.quantity_reserved), 0) AS total_reserved,
      COALESCE(SUM(ws.quantity_allocated), 0) AS total_allocated,
      COALESCE(SUM(ws.quantity_in_transit), 0) AS total_in_transit_internal
      
    FROM
      items i  -- 🔥 START FROM ITEMS TABLE (this is the key change)
      LEFT JOIN inv_warehouse_stock ws ON i.item_code::text = ws.item_code::text 
        AND ws.is_active = true
      LEFT JOIN inv_warehouses w ON ws.warehouse_id = w.id 
        AND w.is_active = true
      LEFT JOIN inv_warehouse_types wt ON w.warehouse_type_id = wt.id
    WHERE
      i.is_active = true  -- Only show active items
    GROUP BY
      i.item_code,
      i.item_name,
      i.part_number,
      i.master_serial_no,
      i.revision,
      i.uom,
      i.unit_price,
      i.standard_cost
  ),
  blanket_reservations AS (
    SELECT
      br_1.item_code,
      COALESCE(
        SUM(br_1.requested_quantity - br_1.delivered_quantity),
        0::bigint
      ) AS pending_release_qty,
      COALESCE(
        SUM(
          CASE
            WHEN br_1.requested_delivery_date >= DATE_TRUNC('month'::text, CURRENT_DATE + '1 mon'::interval)
            AND br_1.requested_delivery_date < DATE_TRUNC('month'::text, CURRENT_DATE + '2 mons'::interval) 
            THEN br_1.requested_quantity - br_1.delivered_quantity
            ELSE 0
          END
        ),
        0::bigint
      ) AS next_month_reserved
    FROM
      blanket_releases br_1
    WHERE
      br_1.status::text = ANY (
        ARRAY[
          'PENDING'::character varying,
          'CONFIRMED'::character varying,
          'IN_TRANSIT'::character varying
        ]::text[]
      )
    GROUP BY
      br_1.item_code
  )
SELECT
  wsp.item_code,
  wsp.item_name,
  wsp.part_number,
  wsp.master_serial_no,
  wsp.revision,
  wsp.uom,
  wsp.unit_price,
  wsp.standard_cost,
  wsp.production_on_hand,
  wsp.production_available,
  wsp.production_reserved,
  wsp.in_transit_qty,
  wsp.in_transit_available,
  wsp.snv_on_hand,
  wsp.snv_available,
  wsp.snv_reserved,
  wsp.snv_allocated,
  wsp.us_transit_on_hand,
  wsp.us_transit_available,
  wsp.us_transit_reserved,
  wsp.distribution_on_hand,
  wsp.distribution_available,
  wsp.quarantine_qty,
  wsp.returns_qty,
  wsp.total_on_hand,
  wsp.total_available,
  wsp.total_reserved,
  wsp.total_allocated,
  COALESCE(br.pending_release_qty, 0::bigint) AS blanket_pending_qty,
  COALESCE(br.next_month_reserved, 0::bigint) AS blanket_next_month_reserved,
  wsp.snv_available + wsp.us_transit_available + wsp.in_transit_available - COALESCE(br.next_month_reserved, 0::bigint) AS net_available_for_customer,
  wsp.snv_available + wsp.us_transit_available + wsp.distribution_available AS warehouse_available,
  wsp.total_reserved + COALESCE(br.next_month_reserved, 0::bigint) AS total_customer_reserved
FROM
  warehouse_stock_pivot wsp
  LEFT JOIN blanket_reservations br ON wsp.item_code::text = br.item_code::text;

-- Now recreate the dashboard view
CREATE VIEW public.vw_item_stock_dashboard AS
WITH
  stock_data AS (
    SELECT
      vw_item_stock_distribution.item_code,
      vw_item_stock_distribution.item_name,
      vw_item_stock_distribution.part_number,
      vw_item_stock_distribution.master_serial_no,
      vw_item_stock_distribution.revision,
      vw_item_stock_distribution.uom,
      vw_item_stock_distribution.unit_price,
      vw_item_stock_distribution.standard_cost,
      vw_item_stock_distribution.production_on_hand,
      vw_item_stock_distribution.production_available,
      vw_item_stock_distribution.production_reserved,
      vw_item_stock_distribution.in_transit_qty,
      vw_item_stock_distribution.in_transit_available,
      vw_item_stock_distribution.snv_on_hand,
      vw_item_stock_distribution.snv_available,
      vw_item_stock_distribution.snv_reserved,
      vw_item_stock_distribution.snv_allocated,
      vw_item_stock_distribution.us_transit_on_hand,
      vw_item_stock_distribution.us_transit_available,
      vw_item_stock_distribution.us_transit_reserved,
      vw_item_stock_distribution.distribution_on_hand,
      vw_item_stock_distribution.distribution_available,
      vw_item_stock_distribution.quarantine_qty,
      vw_item_stock_distribution.returns_qty,
      vw_item_stock_distribution.total_on_hand,
      vw_item_stock_distribution.total_available,
      vw_item_stock_distribution.total_reserved,
      vw_item_stock_distribution.total_allocated,
      vw_item_stock_distribution.blanket_pending_qty,
      vw_item_stock_distribution.blanket_next_month_reserved,
      vw_item_stock_distribution.net_available_for_customer,
      vw_item_stock_distribution.warehouse_available,
      vw_item_stock_distribution.total_customer_reserved
    FROM
      vw_item_stock_distribution
  )
SELECT
  sd.item_code,
  sd.item_name,
  sd.part_number,
  sd.master_serial_no,
  sd.revision,
  sd.uom,
  sd.unit_price,
  sd.standard_cost,
  sd.warehouse_available,
  sd.snv_reserved + sd.us_transit_reserved + COALESCE(sd.blanket_next_month_reserved, 0::bigint) AS warehouse_reserved,
  sd.in_transit_qty AS in_transit_quantity,
  sd.production_on_hand AS production_finished_stock,
  sd.net_available_for_customer,
  sd.snv_available AS snv_stock,
  sd.us_transit_available AS us_transit_stock,
  sd.in_transit_available AS in_transit_stock,
  sd.blanket_next_month_reserved AS reserved_next_month,
  FORMAT(
    '= Warehouse Available (%s) + In Transit (%s) − Reserved (%s)'::text,
    sd.warehouse_available::text,
    sd.in_transit_qty::text,
    (
      sd.snv_reserved + sd.us_transit_reserved + COALESCE(sd.blanket_next_month_reserved, 0::bigint)
    )::text
  ) AS calculation_formula,
  CASE
    WHEN sd.net_available_for_customer < 0 THEN 'CRITICAL'::text
    WHEN sd.net_available_for_customer < 50 THEN 'LOW'::text
    WHEN sd.net_available_for_customer < 200 THEN 'MEDIUM'::text
    ELSE 'HEALTHY'::text
  END AS stock_status,
  sd.total_on_hand,
  sd.total_available,
  sd.quarantine_qty AS quality_hold_qty,
  i.is_active
FROM
  stock_data sd
  JOIN items i ON sd.item_code::text = i.item_code::text;

-- Grant permissions (adjust as needed)
GRANT SELECT ON public.vw_item_stock_distribution TO authenticated;
GRANT SELECT ON public.vw_item_stock_dashboard TO authenticated;