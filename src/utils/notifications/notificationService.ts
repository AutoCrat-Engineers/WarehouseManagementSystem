/**
 * ============================================================================
 * NOTIFICATION SERVICE
 * Centralized notification system — CRUD, real-time, role-based delivery
 * ============================================================================
 */

import { getSupabaseClient } from '../supabase/client';

const supabase = getSupabaseClient();

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type NotificationType =
    | 'request_created'
    | 'request_approved'
    | 'request_rejected'
    | 'request_partial'
    | 'packing_created'
    | 'packing_completed'
    | 'system';

export interface Notification {
    id: string;
    user_id: string;
    title: string;
    message: string;
    type: NotificationType;
    module: string | null;
    reference_id: string | null;
    is_read: boolean;
    read_at: string | null;
    created_by: string | null;
    created_at: string;
}

export interface CreateNotificationInput {
    user_id: string;
    title: string;
    message: string;
    type: NotificationType;
    module?: string;
    reference_id?: string;
    created_by?: string;
}

// ─── FETCH NOTIFICATIONS ─────────────────────────────────────────────────────

/**
 * Fetch all notifications for the currently logged-in user.
 * Returns newest first, limited to 100.
 */
export async function fetchNotifications(): Promise<Notification[]> {
    const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('Error fetching notifications:', error);
        return [];
    }
    return (data || []) as Notification[];
}

/**
 * Fetch unread count for the current user.
 */
export async function fetchUnreadCount(): Promise<number> {
    const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('is_read', false);

    if (error) {
        console.error('Error fetching unread count:', error);
        return 0;
    }
    return count || 0;
}

// ─── MARK AS READ ────────────────────────────────────────────────────────────

/**
 * Mark a single notification as read.
 */
export async function markAsRead(notificationId: string): Promise<boolean> {
    const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);

    if (error) {
        console.error('Error marking notification as read:', error);
        return false;
    }
    return true;
}

/**
 * Mark all notifications as read for the current user.
 */
export async function markAllAsRead(): Promise<boolean> {
    const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('is_read', false);

    if (error) {
        console.error('Error marking all as read:', error);
        return false;
    }
    return true;
}

// ─── CREATE NOTIFICATIONS ────────────────────────────────────────────────────

/**
 * Create a notification for a single user.
 */
export async function createNotification(input: CreateNotificationInput): Promise<boolean> {
    const { error } = await supabase
        .from('notifications')
        .insert({
            user_id: input.user_id,
            title: input.title,
            message: input.message,
            type: input.type,
            module: input.module || null,
            reference_id: input.reference_id || null,
            created_by: input.created_by || null,
        });

    if (error) {
        console.error('Error creating notification:', error);
        return false;
    }
    return true;
}

/**
 * Create notifications for multiple users at once.
 * Used when an operator creates a request and all L2/L1 should be notified.
 */
export async function createNotificationsForUsers(
    userIds: string[],
    title: string,
    message: string,
    type: NotificationType,
    module?: string,
    referenceId?: string,
    createdBy?: string,
): Promise<boolean> {
    if (userIds.length === 0) return true;

    const rows = userIds.map(uid => ({
        user_id: uid,
        title,
        message,
        type,
        module: module || null,
        reference_id: referenceId || null,
        created_by: createdBy || null,
    }));

    const { error } = await supabase.from('notifications').insert(rows);

    if (error) {
        console.error('Error creating bulk notifications:', error);
        return false;
    }
    return true;
}

// ─── ROLE-BASED USER LOOKUPS ─────────────────────────────────────────────────

/**
 * Get all active user IDs with a given role (L1, L2, L3).
 * Used to send notifications to supervisors/managers when an operator submits.
 */
export async function getUserIdsByRole(roles: string[]): Promise<string[]> {
    const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .in('role', roles)
        .eq('is_active', true);

    if (error) {
        console.error('Error fetching users by role:', error);
        return [];
    }
    return (data || []).map((u: any) => u.id);
}

/**
 * Get the current user's ID from session.
 */
export async function getCurrentUserId(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
}

// ─── HIGH-LEVEL NOTIFICATION HELPERS ─────────────────────────────────────────

/**
 * Notify supervisors (L2) and managers (L3) when an operator creates a request.
 */
export async function notifyOnRequestCreated(
    movementNumber: string,
    itemName: string,
    quantity: number,
    createdByUserId: string,
    movementId: string,
): Promise<void> {
    try {
        // Get the operator's name
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', createdByUserId)
            .single();
        const operatorName = profile?.full_name || 'An operator';

        // Notify L2 (supervisors) and L3 (managers)
        const supervisorIds = await getUserIdsByRole(['L2', 'L3']);
        // Don't notify the creator themselves
        const targetIds = supervisorIds.filter(id => id !== createdByUserId);

        if (targetIds.length > 0) {
            await createNotificationsForUsers(
                targetIds,
                'New Movement Request',
                `${operatorName} submitted ${movementNumber} — ${itemName} × ${quantity}. Awaiting your approval.`,
                'request_created',
                'stock-movements',
                movementId,
                createdByUserId,
            );
        }
    } catch (err) {
        console.error('Failed to send request-created notifications:', err);
    }
}

/**
 * Notify the operator when their request is approved, rejected, or partially approved.
 */
export async function notifyOnRequestDecision(
    movementNumber: string,
    itemName: string,
    action: 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED',
    approvedQty: number,
    requestedQty: number,
    operatorUserId: string,
    supervisorUserId: string,
    movementId: string,
): Promise<void> {
    try {
        // Get supervisor name
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', supervisorUserId)
            .single();
        const supervisorName = profile?.full_name || 'A supervisor';

        let title: string;
        let message: string;
        let type: NotificationType;

        if (action === 'REJECTED') {
            title = 'Request Rejected';
            message = `${supervisorName} rejected ${movementNumber} — ${itemName} × ${requestedQty}. No stock was moved.`;
            type = 'request_rejected';
        } else if (action === 'PARTIALLY_APPROVED') {
            title = 'Request Partially Approved';
            message = `${supervisorName} partially approved ${movementNumber} — ${approvedQty} of ${requestedQty} ${itemName} approved.`;
            type = 'request_partial';
        } else {
            title = 'Request Approved';
            message = `${supervisorName} approved ${movementNumber} — ${itemName} × ${requestedQty}. Stock has been moved.`;
            type = 'request_approved';
        }

        // Only notify the operator (not the supervisor themselves)
        if (operatorUserId && operatorUserId !== supervisorUserId) {
            await createNotification({
                user_id: operatorUserId,
                title,
                message,
                type,
                module: 'stock-movements',
                reference_id: movementId,
                created_by: supervisorUserId,
            });
        }
    } catch (err) {
        console.error('Failed to send request-decision notification:', err);
    }
}

/**
 * Notify relevant users when a packing request is created.
 */
export async function notifyOnPackingCreated(
    movementNumber: string,
    itemName: string,
    quantity: number,
    packingRequestId: string,
    createdByUserId: string,
): Promise<void> {
    try {
        // Notify L1 operators about new packing requests
        const operatorIds = await getUserIdsByRole(['L1']);
        const targetIds = operatorIds.filter(id => id !== createdByUserId);

        if (targetIds.length > 0) {
            await createNotificationsForUsers(
                targetIds,
                'New Packing Request',
                `Packing request created for ${movementNumber} — ${itemName} × ${quantity}.`,
                'packing_created',
                'packing',
                packingRequestId,
                createdByUserId,
            );
        }
    } catch (err) {
        console.error('Failed to send packing-created notifications:', err);
    }
}

// ─── REAL-TIME SUBSCRIPTION ──────────────────────────────────────────────────

/**
 * Subscribe to real-time notification changes for the current user.
 * Returns a cleanup function.
 */
export function subscribeToNotifications(
    userId: string,
    onInsert: (notification: Notification) => void,
    onUpdate?: (notification: Notification) => void,
): () => void {
    const channel = supabase
        .channel(`notifications-${userId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${userId}`,
            },
            (payload) => {
                onInsert(payload.new as Notification);
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${userId}`,
            },
            (payload) => {
                onUpdate?.(payload.new as Notification);
            }
        )
        .subscribe();

    return () => {
        supabase.removeChannel(channel);
    };
}
