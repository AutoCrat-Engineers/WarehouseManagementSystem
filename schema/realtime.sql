-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE realtime.messages (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  inserted_at timestamp without time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at)
);
CREATE TABLE realtime.messages_2026_04_10 (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  inserted_at timestamp without time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT messages_2026_04_10_pkey PRIMARY KEY (id, inserted_at)
);
CREATE TABLE realtime.messages_2026_04_11 (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  inserted_at timestamp without time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT messages_2026_04_11_pkey PRIMARY KEY (id, inserted_at)
);
CREATE TABLE realtime.messages_2026_04_12 (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  inserted_at timestamp without time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT messages_2026_04_12_pkey PRIMARY KEY (id, inserted_at)
);
CREATE TABLE realtime.messages_2026_04_13 (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  inserted_at timestamp without time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT messages_2026_04_13_pkey PRIMARY KEY (id, inserted_at)
);
CREATE TABLE realtime.messages_2026_04_14 (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  inserted_at timestamp without time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT messages_2026_04_14_pkey PRIMARY KEY (id, inserted_at)
);
CREATE TABLE realtime.messages_2026_04_15 (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  inserted_at timestamp without time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT messages_2026_04_15_pkey PRIMARY KEY (id, inserted_at)
);
CREATE TABLE realtime.messages_2026_04_16 (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  inserted_at timestamp without time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT messages_2026_04_16_pkey PRIMARY KEY (id, inserted_at)
);
CREATE TABLE realtime.messages_2026_04_17 (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  inserted_at timestamp without time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT messages_2026_04_17_pkey PRIMARY KEY (id, inserted_at)
);
CREATE TABLE realtime.schema_migrations (
  version bigint NOT NULL,
  inserted_at timestamp without time zone,
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
);
CREATE TABLE realtime.subscription (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  subscription_id uuid NOT NULL,
  entity regclass NOT NULL,
  filters ARRAY NOT NULL DEFAULT '{}'::realtime.user_defined_filter[],
  claims jsonb NOT NULL,
  claims_role regrole NOT NULL DEFAULT realtime.to_regrole((claims ->> 'role'::text)),
  created_at timestamp without time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  action_filter text DEFAULT '*'::text CHECK (action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])),
  CONSTRAINT subscription_pkey PRIMARY KEY (id)
);