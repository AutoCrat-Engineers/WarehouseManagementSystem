-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE supabase_migrations.schema_migrations (
  version text NOT NULL,
  statements ARRAY,
  name text,
  created_by text,
  idempotency_key text UNIQUE,
  rollback ARRAY,
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
);