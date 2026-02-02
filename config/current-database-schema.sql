-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
-- Current DB schema reference for Item Master and related features.

CREATE TABLE public.items (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  item_code character varying NOT NULL UNIQUE,
  item_name character varying NOT NULL,
  description text,
  category character varying,
  uom character varying DEFAULT 'PCS'::character varying,
  unit_price numeric,
  standard_cost numeric,
  min_stock_level integer DEFAULT 0,
  max_stock_level integer DEFAULT 0,
  safety_stock integer DEFAULT 0,
  reorder_point integer DEFAULT 0,
  lead_time_days integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT items_pkey PRIMARY KEY (id)
);

CREATE TABLE public.inventory (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  item_code character varying UNIQUE,
  current_stock integer DEFAULT 0,
  allocated_stock integer DEFAULT 0,
  reserved_stock integer DEFAULT 0,
  in_transit_stock integer DEFAULT 0,
  available_stock integer DEFAULT ((current_stock - allocated_stock) - reserved_stock),
  last_movement_date timestamp with time zone,
  last_movement_type character varying,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT inventory_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_item_code_fkey FOREIGN KEY (item_code) REFERENCES public.items(item_code)
);

-- Other tables (blanket_orders, blanket_order_lines, blanket_releases, demand_forecasts,
-- demand_history, planning_recommendations, profiles, roles, stock_movements, etc.)
-- are in the same database; see full schema in project docs if needed.
