/**
 * useSessionPersistence — React hook for versioned session persistence
 * through Edge Functions.
 *
 * Features:
 *   - Auto-recovery on mount (fetches active session from server)
 *   - Debounced PATCH-style updates (only changed fields sent)
 *   - Optimistic concurrency with version tracking
 *   - Automatic conflict resolution (refetch + reconcile)
 *   - Retry with exponential backoff on transient failures
 *   - Session completion/abandonment on workflow end
 *
 * Usage:
 *   const {
 *       sessionId, version, sessionData,
 *       patchSession, completeSession, abandonSession,
 *       isRecovering, isSaving, wasRecovered, lastError,
 *   } = useSessionPersistence('packing_list_wizard', mplId, 'mpl');
 *
 *   // On every meaningful state change:
 *   patchSession({ wizardStep: 'WEIGHTS' });
 *   patchSession({ grossWeights: { [palletId]: 12.5 } });
 *
 *   // On workflow completion:
 *   await completeSession();
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    createOrResumeSession,
    updateSession,
    completeSession as completeSessionApi,
    abandonSession as abandonSessionApi,
    type SessionType,
    SessionApiError,
} from '../services/sessionService';

// ============================================================================
// TYPES
// ============================================================================

interface UseSessionPersistenceOptions {
    /** Debounce delay in ms before persisting to server. Default: 400ms */
    debounceMs?: number;
    /** If true, automatically fetch/create a session on mount. Default: true */
    autoRecover?: boolean;
    /** Initial data to populate on first session creation */
    initialData?: Record<string, any>;
    /** Callback when a session is recovered from server */
    onRecover?: (data: Record<string, any>, isNew: boolean) => void;
    /** Callback when a version conflict occurs. Return merged data or null to use server data. */
    onConflict?: (serverData: Record<string, any>, clientPendingPatch: Record<string, any>) => Record<string, any> | null;
    /** Callback when session save fails (non-conflict) */
    onSaveError?: (error: SessionApiError | Error) => void;
}

interface UseSessionPersistenceReturn {
    /** Server session ID (null until session is created/recovered) */
    sessionId: string | null;
    /** Current server-acknowledged version */
    version: number;
    /** Last known server session data */
    sessionData: Record<string, any> | null;
    /** Whether the hook is currently recovering a session on mount */
    isRecovering: boolean;
    /** Whether a save is in-flight */
    isSaving: boolean;
    /** Whether a previous session was found and recovered */
    wasRecovered: boolean;
    /** Last error from save attempt */
    lastError: SessionApiError | Error | null;
    /**
     * PATCH session data — only send changed fields.
     * Debounced by default. Consecutive rapid calls are coalesced.
     */
    patchSession: (patch: Record<string, any>) => void;
    /**
     * Immediately persist a patch (no debounce).
     * Use for critical saves (e.g. before navigation).
     */
    patchSessionNow: (patch: Record<string, any>) => Promise<void>;
    /** Mark session as completed (workflow finished successfully) */
    completeSession: () => Promise<void>;
    /** Mark session as abandoned (user discards work) */
    abandonSession: () => Promise<void>;
}

// ============================================================================
// HOOK
// ============================================================================

export function useSessionPersistence(
    sessionType: SessionType,
    entityId?: string,
    entityType?: string,
    options: UseSessionPersistenceOptions = {}
): UseSessionPersistenceReturn {
    const {
        debounceMs = 400,
        autoRecover = true,
        initialData = {},
        onRecover,
        onConflict,
        onSaveError,
    } = options;

    // ── State ──
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [version, setVersion] = useState<number>(0);
    const [sessionData, setSessionData] = useState<Record<string, any> | null>(null);
    const [isRecovering, setIsRecovering] = useState(autoRecover);
    const [isSaving, setIsSaving] = useState(false);
    const [wasRecovered, setWasRecovered] = useState(false);
    const [lastError, setLastError] = useState<SessionApiError | Error | null>(null);

    // ── Refs ──
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingPatch = useRef<Record<string, any>>({});
    const isMounted = useRef(true);
    const retryCount = useRef(0);
    const currentVersion = useRef(0);  // Non-reactive version for closures
    const currentSessionId = useRef<string | null>(null);
    const MAX_RETRIES = 3;

    // Keep refs in sync
    useEffect(() => { currentVersion.current = version; }, [version]);
    useEffect(() => { currentSessionId.current = sessionId; }, [sessionId]);

    // ── Cleanup ──
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
        };
    }, []);

    // ── RECOVER / CREATE SESSION ON MOUNT ──
    useEffect(() => {
        if (!autoRecover) {
            setIsRecovering(false);
            return;
        }

        const init = async () => {
            try {
                const result = await createOrResumeSession(
                    sessionType, entityId, entityType, initialData
                );

                if (isMounted.current) {
                    setSessionId(result.session_id);
                    setVersion(result.version);
                    setSessionData(result.session_data);
                    currentVersion.current = result.version;
                    currentSessionId.current = result.session_id;

                    if (!result.is_new) {
                        setWasRecovered(true);
                    }

                    onRecover?.(result.session_data, result.is_new);
                }
            } catch (err) {
                console.error('[useSessionPersistence] init error:', err);
                if (isMounted.current) {
                    setLastError(err instanceof Error ? err : new Error(String(err)));
                }
            } finally {
                if (isMounted.current) setIsRecovering(false);
            }
        };

        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionType, entityId]);

    // ── SERVER PERSIST (with conflict handling + retry) ──
    const persistToServer = useCallback(async (patch: Record<string, any>) => {
        const sid = currentSessionId.current;
        const ver = currentVersion.current;

        if (!sid || !isMounted.current) return;

        setIsSaving(true);
        setLastError(null);

        try {
            const result = await updateSession(sid, patch, ver);

            if (isMounted.current) {
                setVersion(result.version);
                setSessionData(result.session_data);
                currentVersion.current = result.version;
                retryCount.current = 0;
                pendingPatch.current = {};
            }
        } catch (err) {
            if (!isMounted.current) return;

            // ── VERSION CONFLICT ──
            if (err instanceof SessionApiError && err.isConflict) {
                console.warn('[useSessionPersistence] Version conflict detected');

                const serverData = err.serverData;
                const serverVer = err.serverVersion;

                if (serverData && serverVer) {
                    // Let caller reconcile, or accept server data
                    const resolved = onConflict?.(serverData, patch) ?? null;

                    // Update local version to server version
                    setVersion(serverVer);
                    currentVersion.current = serverVer;
                    setSessionData(serverData);

                    // If caller provided merged data, re-save
                    if (resolved) {
                        try {
                            const retryResult = await updateSession(sid, resolved, serverVer);
                            if (isMounted.current) {
                                setVersion(retryResult.version);
                                setSessionData(retryResult.session_data);
                                currentVersion.current = retryResult.version;
                            }
                        } catch (retryErr) {
                            console.error('[useSessionPersistence] conflict retry error:', retryErr);
                            setLastError(retryErr instanceof Error ? retryErr : new Error(String(retryErr)));
                        }
                    }
                }
                return;
            }

            // ── TRANSIENT ERRORS — retry with backoff ──
            setLastError(err instanceof Error ? err : new Error(String(err)));
            onSaveError?.(err instanceof Error ? err : new Error(String(err)));

            if (retryCount.current < MAX_RETRIES) {
                retryCount.current++;
                const delay = Math.pow(2, retryCount.current) * 1000;
                setTimeout(() => {
                    if (isMounted.current && Object.keys(pendingPatch.current).length > 0) {
                        persistToServer(pendingPatch.current);
                    }
                }, delay);
            }
        } finally {
            if (isMounted.current) setIsSaving(false);
        }
    }, [onConflict, onSaveError]);

    // ── DEBOUNCED PATCH ──
    const patchSession = useCallback((patch: Record<string, any>) => {
        // Coalesce rapid patches
        pendingPatch.current = { ...pendingPatch.current, ...patch };

        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            const coalesced = { ...pendingPatch.current };
            if (Object.keys(coalesced).length > 0) {
                persistToServer(coalesced);
            }
        }, debounceMs);
    }, [debounceMs, persistToServer]);

    // ── IMMEDIATE PATCH (no debounce) ──
    const patchSessionNow = useCallback(async (patch: Record<string, any>) => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        pendingPatch.current = { ...pendingPatch.current, ...patch };
        const coalesced = { ...pendingPatch.current };
        await persistToServer(coalesced);
    }, [persistToServer]);

    // ── COMPLETE SESSION ──
    const completeSession = useCallback(async () => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);

        // Flush any pending patches first
        if (Object.keys(pendingPatch.current).length > 0) {
            await persistToServer({ ...pendingPatch.current });
        }

        if (currentSessionId.current) {
            await completeSessionApi(currentSessionId.current);
            if (isMounted.current) {
                setSessionId(null);
                setVersion(0);
                setSessionData(null);
                pendingPatch.current = {};
            }
        }
    }, [persistToServer]);

    // ── ABANDON SESSION ──
    const abandonSession = useCallback(async () => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        pendingPatch.current = {};

        if (currentSessionId.current) {
            try {
                await abandonSessionApi(currentSessionId.current);
            } catch {
                // Non-critical
            }
            if (isMounted.current) {
                setSessionId(null);
                setVersion(0);
                setSessionData(null);
            }
        }
    }, []);

    return {
        sessionId,
        version,
        sessionData,
        isRecovering,
        isSaving,
        wasRecovered,
        lastError,
        patchSession,
        patchSessionNow,
        completeSession,
        abandonSession,
    };
}
