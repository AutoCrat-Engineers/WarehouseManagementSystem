/**
 * ============================================================================
 * NOTIFICATION BELL — Industrial Action Alerts
 * GE / ABB style: Actionable alerts that auto-dismiss on click.
 * No inbox. No history. Click → Navigate → Gone.
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    subscribeToNotifications,
    type Notification,
    type NotificationType,
} from '../../utils/notifications/notificationService';

// ─── PROPS ───────────────────────────────────────────────────────────────────

interface NotificationBellProps {
    userId: string;
    onNavigate?: (module: string, referenceId?: string) => void;
}

// ─── TYPE CONFIG ─────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<NotificationType, { icon: string; accent: string }> = {
    request_created: { icon: '📋', accent: '#2563eb' },
    request_approved: { icon: '✅', accent: '#16a34a' },
    request_rejected: { icon: '✕', accent: '#dc2626' },
    request_partial: { icon: '⚠', accent: '#d97706' },
    packing_created: { icon: '📦', accent: '#7c3aed' },
    packing_completed: { icon: '✓', accent: '#059669' },
    system: { icon: '●', accent: '#6b7280' },
};

// ─── TIME ────────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export function NotificationBell({ userId, onNavigate }: NotificationBellProps) {
    const [alerts, setAlerts] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // Only show unread (actionable) alerts
    const activeAlerts = alerts.filter(n => !n.is_read);
    const count = activeAlerts.length;

    // ── Fetch only unread ──
    const loadAlerts = useCallback(async () => {
        const data = await fetchNotifications();
        setAlerts(data.filter(n => !n.is_read));
    }, []);

    useEffect(() => { loadAlerts(); }, [loadAlerts]);

    // ── Real-time: new alerts appear instantly ──
    useEffect(() => {
        if (!userId) return;
        const unsub = subscribeToNotifications(
            userId,
            (newAlert) => setAlerts(prev => [newAlert, ...prev]),
            (updated) => {
                if (updated.is_read) {
                    // If marked as read (from another tab), remove it
                    setAlerts(prev => prev.filter(n => n.id !== updated.id));
                }
            },
        );
        return unsub;
    }, [userId]);

    // ── Close on outside click ──
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        if (isOpen) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    // ── Click alert → dismiss + navigate ──
    const handleAlertClick = async (alert: Notification) => {
        // Immediately remove from UI
        setAlerts(prev => prev.filter(n => n.id !== alert.id));
        // Mark as read in DB (fire-and-forget)
        markAsRead(alert.id).catch(() => { });
        // Navigate to the module
        if (alert.module && onNavigate) {
            onNavigate(alert.module, alert.reference_id || undefined);
        }
        // Close panel if no more alerts
        if (activeAlerts.length <= 1) setIsOpen(false);
    };

    // ── Mark one as read (no navigation) ──
    const handleMarkOneRead = async (alert: Notification, e: React.MouseEvent) => {
        e.stopPropagation(); // Don't trigger the row click (navigate)
        setAlerts(prev => prev.filter(n => n.id !== alert.id));
        markAsRead(alert.id).catch(() => { });
        if (activeAlerts.length <= 1) setIsOpen(false);
    };

    // ── Dismiss all ──
    const handleDismissAll = async () => {
        setAlerts([]);
        setIsOpen(false);
        markAllAsRead().catch(() => { });
    };

    return (
        <div ref={panelRef} style={{ position: 'relative' }}>
            {/* ── Bell ── */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Notifications"
                style={{
                    position: 'relative',
                    width: '40px',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    borderRadius: '10px',
                    backgroundColor: isOpen ? '#f1f5f9' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 150ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f1f5f9'; }}
                onMouseLeave={(e) => { if (!isOpen) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                    stroke={count > 0 ? '#0f172a' : '#94a3b8'}
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>

                {count > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        width: count > 9 ? '20px' : '16px',
                        height: '16px',
                        borderRadius: '8px',
                        backgroundColor: '#dc2626',
                        color: 'white',
                        fontSize: '10px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                        border: '2px solid var(--card-background, white)',
                    }}>
                        {count > 99 ? '99' : count}
                    </span>
                )}
            </button>

            {/* ── Alert Panel ── */}
            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: '0',
                    width: '380px',
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    boxShadow: '0 16px 48px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.06)',
                    zIndex: 1000,
                    overflow: 'hidden',
                    animation: 'alertPanelIn 0.15s ease-out',
                }}>
                    {/* Header */}
                    <div style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid #f1f5f9',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}>
                        <span style={{
                            fontSize: '13px',
                            fontWeight: 700,
                            color: '#0f172a',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                        }}>
                            Alerts {count > 0 && <span style={{ color: '#64748b', fontWeight: 500 }}>({count})</span>}
                        </span>
                        {count > 0 && (
                            <button
                                onClick={handleDismissAll}
                                style={{
                                    border: 'none',
                                    background: 'none',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: '#64748b',
                                    cursor: 'pointer',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.color = '#0f172a'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b'; }}
                            >
                                Dismiss all
                            </button>
                        )}
                    </div>

                    {/* Alert Items */}
                    <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                        {activeAlerts.length === 0 ? (
                            <div style={{
                                padding: '36px 16px',
                                textAlign: 'center',
                            }}>
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                                    stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                                    style={{ margin: '0 auto 10px', display: 'block' }}>
                                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                                </svg>
                                <p style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', margin: 0 }}>
                                    No pending alerts
                                </p>
                            </div>
                        ) : (
                            activeAlerts.map((alert, idx) => {
                                const cfg = TYPE_CONFIG[alert.type] || TYPE_CONFIG.system;
                                return (
                                    <div
                                        key={alert.id}
                                        onClick={() => handleAlertClick(alert)}
                                        style={{
                                            padding: '12px 16px',
                                            display: 'flex',
                                            gap: '10px',
                                            alignItems: 'flex-start',
                                            cursor: 'pointer',
                                            borderBottom: idx < activeAlerts.length - 1 ? '1px solid #f8fafc' : 'none',
                                            borderLeft: `3px solid ${cfg.accent}`,
                                            transition: 'background 100ms',
                                        }}
                                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f8fafc'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                    >
                                        {/* Accent icon */}
                                        <span style={{
                                            width: '28px',
                                            height: '28px',
                                            borderRadius: '8px',
                                            backgroundColor: `${cfg.accent}12`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '14px',
                                            flexShrink: 0,
                                            color: cfg.accent,
                                            fontWeight: 700,
                                        }}>
                                            {cfg.icon}
                                        </span>

                                        {/* Content */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                fontSize: '13px',
                                                fontWeight: 600,
                                                color: '#0f172a',
                                                lineHeight: 1.3,
                                                marginBottom: '2px',
                                            }}>
                                                {alert.title}
                                            </div>
                                            <div style={{
                                                fontSize: '12px',
                                                color: '#64748b',
                                                lineHeight: 1.35,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                display: '-webkit-box',
                                                WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical',
                                            }}>
                                                {alert.message}
                                            </div>
                                            <div style={{
                                                fontSize: '11px',
                                                color: '#94a3b8',
                                                marginTop: '3px',
                                            }}>
                                                {timeAgo(alert.created_at)}
                                            </div>
                                        </div>

                                        {/* Mark as read — text button */}
                                        <button
                                            onClick={(e) => handleMarkOneRead(alert, e)}
                                            style={{
                                                border: 'none',
                                                background: 'none',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                color: '#94a3b8',
                                                cursor: 'pointer',
                                                padding: '4px 8px',
                                                borderRadius: '6px',
                                                whiteSpace: 'nowrap',
                                                flexShrink: 0,
                                                transition: 'all 120ms ease',
                                                marginTop: '2px',
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = '#f1f5f9';
                                                e.currentTarget.style.color = '#0f172a';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                e.currentTarget.style.color = '#94a3b8';
                                            }}
                                        >
                                            Mark as read
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            <style>{`
        @keyframes alertPanelIn {
          from { opacity: 0; transform: translateY(-4px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
        </div>
    );
}
