import postgres from 'https://deno.land/x/postgresjs@v3.4.4/mod.js';

const DB_URL = Deno.env.get('SUPABASE_DB_URL')!;

/**
 * Atomically advance a Postgres sequence and return the next value.
 * Uses a direct DB connection (SUPABASE_DB_URL) — no named RPC function.
 */
export async function nextSequenceValue(sequenceName: string): Promise<bigint> {
  const sql = postgres(DB_URL, { prepare: false });
  try {
    const [row] = await sql`SELECT nextval(${sequenceName}::regclass) AS seq`;
    return row.seq as bigint;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export function formatMplNumber(seq: bigint | number): string {
  return `MPL-${String(seq).padStart(6, '0')}`;
}

export function formatPiNumber(seq: bigint | number): string {
  return `PI-${String(seq).padStart(6, '0')}`;
}
