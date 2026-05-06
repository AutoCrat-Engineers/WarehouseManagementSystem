/**
 * sessionGuard — Client-side session lifecycle and single-tab enforcement.
 *
 * Responsibilities:
 *   1. Single tab per browser: BroadcastChannel-based mutual exclusion.
 *      A new tab claiming a session forces existing tabs to log out.
 *   2. Idle timeout: detect 10 min of no user input → force logout.
 *   3. Heartbeat: every 60s call auth-validate-session (which atomically
 *      checks status + touches last_activity_at).  Server is the source of
 *      truth for idle / killed / force-takeover state.
 *   4. Surface a typed disconnect reason so App.tsx can render the right
 *      banner: "Session ended elsewhere", "Idle timeout", "Account locked", etc.
 *
 * Designed as a vanilla controller (no React state) so it can be driven from
 * App.tsx with simple onEvent callbacks.
 */
import { FUNCTIONS_BASE } from '../utils/supabase/info';
import { getSupabaseClient } from '../utils/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type DisconnectReason =
  | 'IDLE_TIMEOUT'
  | 'TAB_TAKEOVER'              // another tab in same browser claimed the session
  | 'CONCURRENT_LOGIN'          // server says another device/browser logged in
  | 'ACCOUNT_LOCKED'            // admin deactivated/deleted the account
  | 'SESSION_KILLED'            // generic server kill
  | 'SESSION_ENDED'             // explicit logout (server side)
  | 'SESSION_NOT_FOUND'
  | 'NETWORK_ERROR';            // surfaces only after sustained heartbeat failure

export interface SessionGuardConfig {
  globalSessionId: string;
  accessToken: () => string | null;     // pulled fresh each call (refresh-friendly)
  idleTimeoutMs?: number;               // default 600_000 (10 min)
  heartbeatIntervalMs?: number;         // default 60_000
  onDisconnect: (reason: DisconnectReason, message?: string) => void;
  onIdleWarning?: (secondsRemaining: number) => void;  // optional 60s pre-warning
}

const DEFAULT_IDLE_MS = 10 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 60 * 1000;
const IDLE_WARNING_LEAD_MS = 60 * 1000;       // warn 60s before kick
const ACTIVITY_DEBOUNCE_MS = 1000;
const BROADCAST_CHANNEL_NAME = 'wms-auth-v2';

interface BroadcastClaim {
  type: 'CLAIM' | 'PING' | 'PONG' | 'LOGOUT';
  tabId: string;
  sessionId: string;
  ts: number;
}

function makeTabId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class SessionGuard {
  private cfg: Required<Omit<SessionGuardConfig, 'onIdleWarning'>> & Pick<SessionGuardConfig, 'onIdleWarning'>;
  private tabId = makeTabId();
  private channel: BroadcastChannel | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private lastActivityTs = Date.now();
  private idleCheckTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private idleWarningFired = false;
  private stopped = false;
  private activityListener: () => void;
  private visibilityListener: () => void;
  private storageListener: (e: StorageEvent) => void;
  private channelListener: (e: MessageEvent) => void;

  constructor(cfg: SessionGuardConfig) {
    this.cfg = {
      idleTimeoutMs: cfg.idleTimeoutMs ?? DEFAULT_IDLE_MS,
      heartbeatIntervalMs: cfg.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS,
      onIdleWarning: cfg.onIdleWarning,
      ...cfg,
    };

    let lastFired = 0;
    this.activityListener = () => {
      const now = Date.now();
      if (now - lastFired < ACTIVITY_DEBOUNCE_MS) return;
      lastFired = now;
      this.lastActivityTs = now;
      this.idleWarningFired = false;
    };

    this.visibilityListener = () => {
      if (document.visibilityState === 'visible') {
        this.lastActivityTs = Date.now();
        void this.heartbeat();
      }
    };

    this.storageListener = (e) => {
      // Fallback for browsers/contexts without BroadcastChannel.
      if (e.key !== 'wms_auth_owner_v2') return;
      try {
        const claim = JSON.parse(e.newValue ?? 'null');
        if (claim?.tabId && claim.tabId !== this.tabId && claim.sessionId) {
          this.disconnect('TAB_TAKEOVER', 'This account was opened in another tab.');
        }
      } catch { /* ignore */ }
    };

    this.channelListener = (e) => {
      const msg = e.data as BroadcastClaim | undefined;
      if (!msg || msg.tabId === this.tabId) return;
      if (msg.type === 'CLAIM') {
        // Another tab is claiming. If it's the same session, two tabs are
        // racing — newest CLAIM wins; we step down.
        this.disconnect('TAB_TAKEOVER', 'This account was opened in another tab.');
      }
    };
  }

  /** Begin guarding.  Call once, immediately after a successful login. */
  start(): void {
    if (this.stopped) return;

    // 1. Claim the broadcast channel.  Anyone else listening logs out.
    try {
      this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      this.channel.addEventListener('message', this.channelListener);
      this.broadcast({ type: 'CLAIM' });
    } catch {
      this.channel = null;
    }
    try {
      localStorage.setItem('wms_auth_owner_v2', JSON.stringify({
        tabId: this.tabId, sessionId: this.cfg.globalSessionId, ts: Date.now(),
      }));
    } catch { /* ignore */ }

    // 2. Listen for activity.
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    window.addEventListener('mousedown', this.activityListener, opts);
    window.addEventListener('keydown', this.activityListener, opts);
    window.addEventListener('scroll', this.activityListener, opts);
    window.addEventListener('touchstart', this.activityListener, opts);
    document.addEventListener('visibilitychange', this.visibilityListener);
    window.addEventListener('storage', this.storageListener);

    // 3. Idle ticker.
    this.idleCheckTimer = window.setInterval(() => this.tickIdle(), 5000);

    // 4. Heartbeat (fallback; Realtime push below is the primary signal).
    this.heartbeatTimer = window.setInterval(() => { void this.heartbeat(); }, this.cfg.heartbeatIntervalMs);
    void this.heartbeat();

    // 5. Realtime: subscribe to UPDATEs on this session row.  When auth-login
    //    on another browser flips status from ACTIVE -> KILLED, we get the
    //    event in well under a second and disconnect immediately — no need to
    //    wait for the 60s heartbeat.  RLS (migration 067) restricts visibility
    //    to the owning user.
    try {
      const supabase = getSupabaseClient();
      this.realtimeChannel = supabase
        .channel(`sg-${this.cfg.globalSessionId}`)
        .on(
          'postgres_changes',
          {
            event:  'UPDATE',
            schema: 'public',
            table:  'global_sessions',
            filter: `id=eq.${this.cfg.globalSessionId}`,
          },
          (payload) => {
            const newStatus = (payload.new as any)?.status;
            const reason    = (payload.new as any)?.ended_reason;
            if (!newStatus || newStatus === 'ACTIVE') return;
            switch (newStatus) {
              case 'KILLED':
                if (reason === 'ADMIN_DEACTIVATED' || reason === 'ADMIN_DELETED') {
                  return this.disconnect('ACCOUNT_LOCKED',
                    'Account is locked. Please contact your administrator.');
                }
                return this.disconnect('CONCURRENT_LOGIN',
                  reason === 'FORCE_TAKEOVER'
                    ? 'Your session was forcibly taken over by another sign-in.'
                    : 'Your session was ended because your account signed in elsewhere.');
              case 'IDLE_EXPIRED':
                return this.disconnect('IDLE_TIMEOUT', 'Your session expired due to inactivity.');
              case 'ENDED':
                return this.disconnect('SESSION_ENDED', 'Your session has been logged out.');
              default:
                return this.disconnect('SESSION_KILLED', 'Your session is no longer valid.');
            }
          },
        )
        .subscribe();
    } catch (err) {
      console.warn('[SessionGuard] Realtime subscription failed; heartbeat will still detect kills:', err);
    }
  }

  /** Stop all listeners.  Call on logout / unmount. */
  stop(): void {
    this.stopped = true;
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    window.removeEventListener('mousedown', this.activityListener, opts);
    window.removeEventListener('keydown', this.activityListener, opts);
    window.removeEventListener('scroll', this.activityListener, opts);
    window.removeEventListener('touchstart', this.activityListener, opts);
    document.removeEventListener('visibilitychange', this.visibilityListener);
    window.removeEventListener('storage', this.storageListener);

    if (this.idleCheckTimer != null) { window.clearInterval(this.idleCheckTimer); this.idleCheckTimer = null; }
    if (this.heartbeatTimer != null) { window.clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }

    if (this.channel) {
      try {
        this.broadcast({ type: 'LOGOUT' });
        this.channel.removeEventListener('message', this.channelListener);
        this.channel.close();
      } catch { /* ignore */ }
      this.channel = null;
    }
    if (this.realtimeChannel) {
      try {
        const supabase = getSupabaseClient();
        supabase.removeChannel(this.realtimeChannel);
      } catch { /* ignore */ }
      this.realtimeChannel = null;
    }
    try {
      const owner = JSON.parse(localStorage.getItem('wms_auth_owner_v2') ?? 'null');
      if (owner?.tabId === this.tabId) localStorage.removeItem('wms_auth_owner_v2');
    } catch { /* ignore */ }
  }

  private broadcast(partial: Pick<BroadcastClaim, 'type'>): void {
    try {
      this.channel?.postMessage({
        ...partial,
        tabId: this.tabId,
        sessionId: this.cfg.globalSessionId,
        ts: Date.now(),
      } satisfies BroadcastClaim);
    } catch { /* ignore */ }
  }

  private tickIdle(): void {
    if (this.stopped) return;
    const idleMs = Date.now() - this.lastActivityTs;

    if (idleMs >= this.cfg.idleTimeoutMs) {
      this.disconnect('IDLE_TIMEOUT', 'You were signed out due to inactivity.');
      return;
    }

    const remainingMs = this.cfg.idleTimeoutMs - idleMs;
    if (!this.idleWarningFired && remainingMs <= IDLE_WARNING_LEAD_MS) {
      this.idleWarningFired = true;
      this.cfg.onIdleWarning?.(Math.ceil(remainingMs / 1000));
    }
  }

  private async heartbeat(): Promise<void> {
    if (this.stopped) return;
    const token = this.cfg.accessToken();
    if (!token) return;

    try {
      const res = await fetch(`${FUNCTIONS_BASE}/auth-validate-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ global_session_id: this.cfg.globalSessionId }),
      });

      let body: any = null;
      try { body = await res.json(); } catch { /* ignore */ }

      if (res.ok && body?.valid === true) return;

      const code = (body?.code ?? body?.status ?? '').toString().toUpperCase();
      switch (code) {
        case 'IDLE_EXPIRED':
          return this.disconnect('IDLE_TIMEOUT', 'Your session expired due to inactivity.');
        case 'KILLED':
          return this.disconnect('CONCURRENT_LOGIN',
            'Your session was ended because your account signed in elsewhere.');
        case 'ENDED':
          return this.disconnect('SESSION_ENDED', 'Your session has been logged out.');
        case 'NOT_FOUND':
          return this.disconnect('SESSION_NOT_FOUND', 'Session not found. Please sign in again.');
        case 'INVALID_JWT':
          return this.disconnect('SESSION_KILLED', 'Your sign-in is no longer valid. Please sign in again.');
        default:
          // Treat 5xx / unknown as transient — leave running.
          return;
      }
    } catch {
      // Network blip — don't tear down on a single failure.
      return;
    }
  }

  private disconnect(reason: DisconnectReason, message?: string): void {
    if (this.stopped) return;
    this.stop();
    try { this.cfg.onDisconnect(reason, message); }
    catch (err) { console.error('SessionGuard.onDisconnect threw:', err); }
  }
}
