import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders } from "../_shared/cors.ts";

const SESSION_TYPES = new Set([
  "dispatch_selection",
  "packing_list_wizard",
  "stock_movement_form",
  "contract_config",
  "item_edit",
]);

const ACTIVE_STATUSES = new Set(["draft", "in_progress"]);
const CLOSED_STATUSES = new Set(["completed", "abandoned"]);

function jsonResponse(
  corsHeaders: Record<string, string>,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function apiError(
  corsHeaders: Record<string, string>,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse(corsHeaders, status, {
    error: code,
    message,
    ...(details ? { details } : {}),
  });
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensureRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    const current = next[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      next[key] = deepMerge(
        current as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      next[key] = value;
    }
  }

  return next;
}

async function getAuthenticatedUser(req: Request, adminClient: any): Promise<{ id: string }> {
  const authHeader = req.headers.get("Authorization");
  const jwt = authHeader?.replace("Bearer ", "").trim();

  if (!jwt) {
    throw new Error("UNAUTHORIZED");
  }

  const { data: { user }, error } = await adminClient.auth.getUser(jwt);
  if (error || !user) {
    throw new Error("UNAUTHORIZED");
  }

  return { id: user.id };
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin") ?? undefined);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return apiError(corsHeaders, 405, "INVALID_INPUT", "Method not allowed.");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const user = await getAuthenticatedUser(req, adminClient);
    const url = new URL(req.url);
    const route = url.pathname.replace(/\/+$/, "") || "/";

    let body: Record<string, unknown> = {};
    try {
      body = ensureRecord(await req.json());
    } catch {
      body = {};
    }

    if (route.endsWith("/create")) {
      const sessionType = normalizeOptionalString(body.session_type);
      const entityId = normalizeOptionalString(body.entity_id);
      const entityType = normalizeOptionalString(body.entity_type);
      const initialData = ensureRecord(body.initial_data);

      if (!sessionType || !SESSION_TYPES.has(sessionType)) {
        return apiError(corsHeaders, 400, "INVALID_INPUT", "Invalid session_type.");
      }

      const { data: existing, error: existingError } = await adminClient
        .from("workflow_sessions")
        .select("id, status, version, session_data")
        .eq("user_id", user.id)
        .eq("session_type", sessionType)
        .is("entity_id", entityId)
        .is("entity_type", entityType)
        .in("status", ["draft", "in_progress"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) {
        console.error("session-manager create lookup failed:", existingError);
        return apiError(corsHeaders, 500, "INTERNAL_ERROR", "Failed to load session.");
      }

      if (existing) {
        return jsonResponse(corsHeaders, 200, {
          session_id: existing.id,
          version: existing.version,
          session_data: existing.session_data ?? {},
          status: existing.status,
          is_new: false,
        });
      }

      const insertPayload = {
        user_id: user.id,
        session_type: sessionType,
        entity_id: entityId,
        entity_type: entityType,
        status: "draft",
        version: 0,
        session_data: initialData,
      };

      const { data: created, error: createError } = await adminClient
        .from("workflow_sessions")
        .insert(insertPayload)
        .select("id, status, version, session_data")
        .single();

      if (createError || !created) {
        console.error("session-manager create insert failed:", createError);
        return apiError(corsHeaders, 500, "INTERNAL_ERROR", "Failed to create session.");
      }

      return jsonResponse(corsHeaders, 200, {
        session_id: created.id,
        version: created.version,
        session_data: created.session_data ?? {},
        status: created.status,
        is_new: true,
      });
    }

    if (route.endsWith("/update")) {
      const sessionId = normalizeOptionalString(body.session_id);
      const patch = ensureRecord(body.patch);
      const version = typeof body.version === "number" ? body.version : Number.NaN;

      if (!sessionId || !Number.isInteger(version)) {
        return apiError(corsHeaders, 400, "INVALID_INPUT", "session_id and integer version are required.");
      }

      const { data: existing, error: lookupError } = await adminClient
        .from("workflow_sessions")
        .select("id, status, version, session_data")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (lookupError) {
        console.error("session-manager update lookup failed:", lookupError);
        return apiError(corsHeaders, 500, "INTERNAL_ERROR", "Failed to load session.");
      }

      if (!existing) {
        return apiError(corsHeaders, 404, "SESSION_NOT_FOUND", "Session not found.");
      }

      if (CLOSED_STATUSES.has(existing.status)) {
        return apiError(corsHeaders, 409, "SESSION_CLOSED", "Session is already closed.", {
          server_version: existing.version,
          server_data: existing.session_data ?? {},
        });
      }

      if (!ACTIVE_STATUSES.has(existing.status)) {
        return apiError(corsHeaders, 409, "SESSION_EXPIRED", "Session is not editable.", {
          server_version: existing.version,
          server_data: existing.session_data ?? {},
        });
      }

      if (existing.version !== version) {
        return apiError(corsHeaders, 409, "VERSION_CONFLICT", "Version conflict detected.", {
          server_version: existing.version,
          server_data: existing.session_data ?? {},
        });
      }

      const mergedData = deepMerge(ensureRecord(existing.session_data), patch);
      const nextStatus = existing.status === "draft" ? "in_progress" : existing.status;

      const { data: updated, error: updateError } = await adminClient
        .from("workflow_sessions")
        .update({
          session_data: mergedData,
          version: existing.version + 1,
          status: nextStatus,
        })
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .eq("version", existing.version)
        .select("id, version, session_data")
        .maybeSingle();

      if (updateError) {
        console.error("session-manager update failed:", updateError);
        return apiError(corsHeaders, 500, "INTERNAL_ERROR", "Failed to update session.");
      }

      if (!updated) {
        const { data: latest } = await adminClient
          .from("workflow_sessions")
          .select("version, session_data")
          .eq("id", sessionId)
          .eq("user_id", user.id)
          .maybeSingle();

        return apiError(corsHeaders, 409, "VERSION_CONFLICT", "Version conflict detected.", {
          server_version: latest?.version ?? existing.version,
          server_data: latest?.session_data ?? existing.session_data ?? {},
        });
      }

      return jsonResponse(corsHeaders, 200, {
        session_id: sessionId,
        version: updated.version,
        session_data: updated.session_data ?? {},
      });
    }

    if (route.endsWith("/complete") || route.endsWith("/abandon")) {
      const sessionId = normalizeOptionalString(body.session_id);
      if (!sessionId) {
        return apiError(corsHeaders, 400, "INVALID_INPUT", "session_id is required.");
      }

      const targetStatus = route.endsWith("/complete") ? "completed" : "abandoned";
      const timestampColumn = route.endsWith("/complete") ? "completed_at" : "abandoned_at";

      const { data: updated, error: updateError } = await adminClient
        .from("workflow_sessions")
        .update({
          status: targetStatus,
          [timestampColumn]: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .in("status", ["draft", "in_progress"])
        .select("id")
        .maybeSingle();

      if (updateError) {
        console.error("session-manager close failed:", updateError);
        return apiError(corsHeaders, 500, "INTERNAL_ERROR", "Failed to close session.");
      }

      if (!updated) {
        const { data: existing } = await adminClient
          .from("workflow_sessions")
          .select("status")
          .eq("id", sessionId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!existing) {
          return apiError(corsHeaders, 404, "SESSION_NOT_FOUND", "Session not found.");
        }

        return apiError(corsHeaders, 409, "SESSION_CLOSED", "Session is already closed.");
      }

      return jsonResponse(corsHeaders, 200, { success: true });
    }

    return apiError(corsHeaders, 404, "INVALID_INPUT", "Unknown session-manager route.");
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return apiError(corsHeaders, 401, "UNAUTHORIZED", "Not authenticated.");
    }

    console.error("session-manager error:", error);
    return apiError(corsHeaders, 500, "INTERNAL_ERROR", "Unexpected server error.");
  }
};

const port = Number(Deno.env.get("PORT"));

if (Number.isInteger(port) && port > 0) {
  Deno.serve({ port }, handler);
} else {
  Deno.serve(handler);
}
