/**
 * PackingDetail — Box-level packing with per-box PKG IDs and stock transfer (v5).
 *
 * Architecture (v5):
 *   - Movement # is the primary reference
 *   - Each BOX gets a unique Packing ID (PKG-XXXXXXXX)
 *   - Stock does NOT move on approval — only on explicit operator action
 *   - "Move Packed Stock" — partial transfer of printed boxes to Prod WHSE
 *   - "Complete Packing" → validates all boxes + triggers stock transfer
 *   - Transfer status shown per box (Transferred / Pending)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/EnterpriseUI';
import { StickerPrint } from './StickerPrint';
import * as svc from './packingService';
import {
    PACKING_STATUS_CONFIG, AUDIT_ACTION_LABELS,
    generatePackingId, formatAuditDetails,
} from '../../types/packing';
import type { PackingRequest, PackingBox, PackingAuditLog, StickerData, PackingRequestStatus } from '../../types/packing';
import { getSupabaseClient } from '../../utils/supabase/client';

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface PackingDetailProps {
    requestId: string;
    userRole: UserRole;
    onBack: () => void;
    currentUserName: string;
}

export function PackingDetail({ requestId, userRole, onBack, currentUserName }: PackingDetailProps) {
    const supabase = getSupabaseClient();

    const [request, setRequest] = useState<PackingRequest | null>(null);
    const [boxes, setBoxes] = useState<PackingBox[]>([]);
    const [auditLogs, setAuditLogs] = useState<PackingAuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [addQty, setAddQty] = useState<number>(0);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
    const [stickerData, setStickerData] = useState<StickerData | null>(null);
    const [activeTab, setActiveTab] = useState<'boxes' | 'audit'>('boxes');
    const [showTransferConfirm, setShowTransferConfirm] = useState(false);
    const [transferType, setTransferType] = useState<'partial' | 'complete'>('partial');

    // ============================================================================
    // DATA LOADING
    // ============================================================================

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const { data: reqRow, error: reqErr } = await supabase
                .from('packing_requests')
                .select('*')
                .eq('id', requestId)
                .single();
            if (reqErr || !reqRow) throw new Error(reqErr?.message || 'Packing request not found');

            // Enrich with item info (including revision)
            let itemName = reqRow.item_code;
            let partNumber: string | null = null;
            let masterSerialNo: string | null = null;
            let revision: string | null = null;
            const { data: itemData } = await supabase
                .from('items')
                .select('item_name, part_number, master_serial_no, revision')
                .eq('item_code', reqRow.item_code)
                .single();
            if (itemData) {
                itemName = itemData.item_name || reqRow.item_code;
                partNumber = itemData.part_number || null;
                masterSerialNo = itemData.master_serial_no || null;
                revision = itemData.revision || null;
            }

            // Enrich with profile names
            let createdByName = '';
            let approvedByName = '';
            const userIds = [reqRow.created_by, reqRow.approved_by].filter(Boolean);
            if (userIds.length) {
                const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
                (profiles || []).forEach((p: any) => {
                    if (p.id === reqRow.created_by) createdByName = p.full_name;
                    if (p.id === reqRow.approved_by) approvedByName = p.full_name;
                });
            }

            const enrichedReq: PackingRequest = {
                ...reqRow,
                item_name: itemName,
                part_number: partNumber,
                master_serial_no: masterSerialNo,
                revision: revision,
                created_by_name: createdByName,
                approved_by_name: approvedByName,
                transferred_qty: reqRow.transferred_qty || 0,
            };
            setRequest(enrichedReq);

            const b = await svc.fetchBoxesForRequest(requestId);
            setBoxes(b);

            const a = await svc.fetchAuditLogs(requestId);
            setAuditLogs(a);
        } catch (err: any) {
            console.error('PackingDetail loadData error:', err);
            setMessage({ type: 'error', text: err.message || 'Failed to load data' });
        } finally { setLoading(false); }
    }, [requestId, supabase]);

    useEffect(() => { loadData(); }, [loadData]);

    // ============================================================================
    // COMPUTED VALUES
    // ============================================================================

    const isOperator = userRole === 'L1';
    const status = (request?.status || 'APPROVED') as PackingRequestStatus;
    const isPacking = status === 'PACKING_IN_PROGRESS';
    const isApproved = status === 'APPROVED';
    const isRejected = status === 'REJECTED';
    const isCompleted = status === 'COMPLETED';
    const isPartiallyTransferred = status === 'PARTIALLY_TRANSFERRED';
    const canPack = isPacking || isPartiallyTransferred;
    const totalQty = Number(request?.total_packed_qty || 0);
    const totalBoxQty = boxes.reduce((s, b) => s + Number(b.box_qty), 0);
    const remaining = totalQty - totalBoxQty;
    const isFullyPacked = remaining === 0 && boxes.length > 0;
    const allStickersPrinted = boxes.length > 0 && boxes.every(b => b.sticker_printed);
    const transferredQty = Number(request?.transferred_qty || 0);
    const untransferredBoxes = boxes.filter(b => b.sticker_printed && !b.is_transferred);
    const untransferredQty = untransferredBoxes.reduce((s, b) => s + Number(b.box_qty), 0);
    const hasUntransferred = untransferredBoxes.length > 0;
    const allBoxesTransferred = boxes.length > 0 && boxes.every(b => b.is_transferred);
    const canComplete = isFullyPacked && allStickersPrinted;
    const statusCfg = PACKING_STATUS_CONFIG[status];
    const progressPct = totalQty > 0 ? Math.round((totalBoxQty / totalQty) * 100) : 0;
    const transferPct = totalQty > 0 ? Math.round((transferredQty / totalQty) * 100) : 0;

    // ============================================================================
    // HANDLERS
    // ============================================================================

    const handleStartPacking = async () => {
        setSubmitting(true);
        setMessage(null);
        try {
            await svc.startPacking(requestId);
            setMessage({ type: 'success', text: 'Packing started. Add boxes to split the approved quantity.' });
            await loadData();
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Cannot start packing' });
        } finally { setSubmitting(false); }
    };

    const handleAddBox = async () => {
        if (addQty <= 0) { setMessage({ type: 'error', text: 'Box quantity must be greater than 0.' }); return; }
        if (addQty > remaining) { setMessage({ type: 'error', text: `Qty ${addQty} exceeds remaining (${remaining}).` }); return; }
        setSubmitting(true);
        setMessage(null);
        try {
            const newBox = await svc.addBox(requestId, addQty);
            setAddQty(0);
            setMessage({ type: 'success', text: `Box #${newBox.box_number} created — ${addQty} PCS — PKG: ${newBox.packing_id}` });
            await loadData();
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Failed to add box' });
        } finally { setSubmitting(false); }
    };

    const handleDeleteBox = async (boxId: string) => {
        if (!confirm('Remove this box? This action cannot be undone.')) return;
        try {
            await svc.deleteBox(requestId, boxId);
            setMessage({ type: 'success', text: 'Box removed.' });
            await loadData();
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Cannot delete box' });
        }
    };

    const handlePrintSticker = (box: PackingBox) => {
        if (!request) return;
        setStickerData({
            packingId: box.packing_id || generatePackingId(box.id),
            partNumber: request.part_number || request.item_code,
            description: request.item_name || '',
            mslNo: request.master_serial_no || '—',
            revision: request.revision || '—',
            movementNumber: request.movement_number,
            packingRequestId: request.id,
            boxNumber: box.box_number,
            totalBoxes: boxes.length,
            boxQuantity: Number(box.box_qty),
            totalQuantity: totalQty,
            packingDate: new Date().toLocaleDateString('en-IN'),
            itemCode: request.item_code,
            operatorName: currentUserName,
        });
    };

    const handleStickerPrinted = async () => {
        if (!stickerData) return;
        const box = boxes.find(b => b.box_number === stickerData.boxNumber);
        if (box) {
            try {
                await svc.markStickerPrinted(requestId, box.id);
                await loadData();
            } catch (err: any) { console.error('Sticker print tracking error:', err); }
        }
        setStickerData(null);
    };

    const handlePrintNextSticker = () => {
        const unprintedBoxes = boxes.filter(b => !b.sticker_printed);
        if (unprintedBoxes.length === 0) {
            setMessage({ type: 'error', text: 'All stickers have already been printed.' });
            return;
        }
        handlePrintSticker(unprintedBoxes[0]);
    };

    // Partial stock transfer — move printed boxes to Prod WHSE
    const handleMovePackedStock = () => {
        if (untransferredBoxes.length === 0) {
            setMessage({ type: 'error', text: 'No printed boxes available for transfer. Print stickers first.' });
            return;
        }
        setTransferType('partial');
        setShowTransferConfirm(true);
    };

    // Complete packing — validate and transfer remaining
    const handleCompletePacking = () => {
        if (!canComplete) {
            setMessage({ type: 'error', text: 'All boxes must be filled and all stickers printed before completing.' });
            return;
        }
        setTransferType('complete');
        setShowTransferConfirm(true);
    };

    // Confirm stock transfer
    const handleConfirmTransfer = async () => {
        setShowTransferConfirm(false);
        setSubmitting(true);
        setMessage(null);
        try {
            if (transferType === 'complete') {
                await svc.completePacking(requestId);
                setMessage({ type: 'success', text: 'Packing completed. All stock has been transferred to Prod WHSE.' });
            } else {
                const result = await svc.transferPackedStock(requestId);
                if (result.isComplete) {
                    setMessage({ type: 'success', text: `All stock transferred to Prod WHSE — ${result.transferredQty} PCS in ${result.boxesTransferred} box(es). Packing completed.` });
                } else {
                    setMessage({ type: 'success', text: `${result.transferredQty} PCS moved to Prod WHSE (${result.boxesTransferred} box(es)). Remaining stock can be transferred after packing more boxes.` });
                }
            }
            await loadData();
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Failed to transfer stock' });
        } finally { setSubmitting(false); }
    };

    // ============================================================================
    // STYLES
    // ============================================================================

    const cellStyle: React.CSSProperties = {
        padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #f0f0f0', color: '#111827',
    };
    const headerCellStyle: React.CSSProperties = {
        ...cellStyle, fontWeight: 700, fontSize: 11, color: '#374151',
        textTransform: 'uppercase' as const, letterSpacing: '0.5px',
        background: '#f9fafb', borderBottom: '2px solid #e5e7eb',
    };
    const labelStyle: React.CSSProperties = {
        fontSize: 11, fontWeight: 700, color: '#6b7280',
        textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: 2,
    };
    const valueStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#111827' };
    const btnBase: React.CSSProperties = {
        padding: '7px 14px', borderRadius: 3, fontSize: 12, fontWeight: 600,
        cursor: 'pointer', border: '1px solid #d1d5db', background: '#fff',
        color: '#374151', transition: 'all 0.1s',
    };
    const btnPrimary: React.CSSProperties = {
        ...btnBase, background: '#1e3a8a', color: '#fff', border: '1px solid #1e3a8a',
    };
    const btnSuccess: React.CSSProperties = {
        ...btnBase, background: '#16a34a', color: '#fff', border: '1px solid #16a34a',
    };
    const btnWarning: React.CSSProperties = {
        ...btnBase, background: '#d97706', color: '#fff', border: '1px solid #d97706',
    };
    const btnDanger: React.CSSProperties = {
        ...btnBase, background: '#fff', color: '#dc2626', border: '1px solid #fca5a5',
    };

    // ============================================================================
    // LOADING / ERROR
    // ============================================================================

    if (loading && !request) {
        return (
            <div style={{ padding: 60, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
                Loading packing request...
            </div>
        );
    }

    if (!request) {
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <p style={{ color: '#dc2626', fontSize: 14 }}>Packing request not found.</p>
                <button onClick={onBack} style={{ ...btnBase, marginTop: 16 }}>Back</button>
            </div>
        );
    }

    // ============================================================================
    // RENDER
    // ============================================================================

    return (
        <div>
            {/* Header Bar — Movement # as primary identifier */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20,
                paddingBottom: 16, borderBottom: '2px solid #e5e7eb', flexWrap: 'wrap',
            }}>
                <button onClick={onBack} style={{ ...btnBase, fontWeight: 700, color: '#1e3a8a' }}>
                    &larr; Back
                </button>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px' }}>
                        {request.movement_number}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        Packing for {request.item_code} — {request.item_name || ''}
                    </div>
                </div>
                <span style={{
                    padding: '5px 14px', borderRadius: 3, fontSize: 12,
                    fontWeight: 700, color: statusCfg.color, backgroundColor: statusCfg.bg,
                    border: `1px solid ${statusCfg.color}20`,
                }}>
                    {statusCfg.label.toUpperCase()}
                </span>
            </div>

            {/* Message Banner */}
            {message && (
                <div style={{
                    padding: '10px 16px', borderRadius: 3, marginBottom: 16, fontSize: 13,
                    fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
                    color: message.type === 'error' ? '#dc2626' : message.type === 'info' ? '#2563eb' : '#16a34a',
                    backgroundColor: message.type === 'error' ? '#fef2f2' : message.type === 'info' ? '#eff6ff' : '#f0fdf4',
                    border: `1px solid ${message.type === 'error' ? '#fca5a5' : message.type === 'info' ? '#93c5fd' : '#86efac'}`,
                }}>
                    <span style={{ flex: 1 }}>{message.text}</span>
                    <button onClick={() => setMessage(null)} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 16, color: 'inherit', padding: '0 4px',
                    }}>×</button>
                </div>
            )}

            {/* Cancelled Banner */}
            {isRejected && (
                <div style={{
                    padding: '14px 20px', borderRadius: 3, marginBottom: 20,
                    background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b',
                }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Movement Rejected</div>
                    <div style={{ fontSize: 13 }}>
                        No stock was transferred. Supervisor: {request.approved_by_name || '—'}
                        {request.supervisor_remarks && <> — "{request.supervisor_remarks}"</>}
                    </div>
                </div>
            )}

            {/* Completed Banner */}
            {isCompleted && (
                <div style={{
                    padding: '14px 20px', borderRadius: 3, marginBottom: 20,
                    background: '#f0fdf4', border: '1px solid #86efac', color: '#166534',
                }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Packing Completed — Stock in Prod WHSE</div>
                    <div style={{ fontSize: 13 }}>
                        All {totalQty} PCS packed into {boxes.length} box(es) and transferred to Production Warehouse.
                        Completed on {request.completed_at ? new Date(request.completed_at).toLocaleString('en-IN') : '—'}.
                    </div>
                </div>
            )}

            {/* Partial Transfer Info Banner */}
            {isPartiallyTransferred && (
                <div style={{
                    padding: '14px 20px', borderRadius: 3, marginBottom: 20,
                    background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e',
                }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Partial Stock Transfer</div>
                    <div style={{ fontSize: 13 }}>
                        {transferredQty} of {totalQty} PCS have been transferred to Prod WHSE.
                        Continue packing remaining {totalQty - transferredQty} PCS or move completed boxes.
                    </div>
                </div>
            )}

            {/* Document Details Section */}
            {!isRejected && (
                <Card>
                    <div style={{
                        fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 12,
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                        paddingBottom: 8, borderBottom: '1px solid #e5e7eb',
                    }}>
                        DOCUMENT DETAILS
                    </div>
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '14px 24px',
                    }}>
                        <div><div style={labelStyle}>Movement No</div><div style={{ ...valueStyle, fontFamily: 'monospace', color: '#1e3a8a' }}>{request.movement_number}</div></div>
                        <div><div style={labelStyle}>Item Code</div><div style={valueStyle}>{request.item_code}</div></div>
                        <div><div style={labelStyle}>Description</div><div style={valueStyle}>{request.item_name || '—'}</div></div>
                        <div><div style={labelStyle}>Part Number</div><div style={valueStyle}>{request.part_number || '—'}</div></div>
                        <div><div style={labelStyle}>MSL No</div><div style={valueStyle}>{request.master_serial_no || '—'}</div></div>
                        <div><div style={labelStyle}>Revision</div><div style={{ ...valueStyle, color: request.revision ? '#7c3aed' : '#9ca3af' }}>{request.revision || '—'}</div></div>
                        <div><div style={labelStyle}>Approved Qty</div><div style={{ ...valueStyle, fontSize: 18, color: '#1e3a8a' }}>{totalQty} PCS</div></div>
                        <div><div style={labelStyle}>Requested By</div><div style={valueStyle}>{request.created_by_name || '—'}</div></div>
                        <div><div style={labelStyle}>Approved By</div><div style={valueStyle}>{request.approved_by_name || '—'}</div></div>
                        <div><div style={labelStyle}>Created</div><div style={valueStyle}>{new Date(request.created_at).toLocaleString('en-IN')}</div></div>
                        {request.supervisor_remarks && (
                            <div style={{ gridColumn: '1 / -1' }}>
                                <div style={labelStyle}>Supervisor Remarks</div>
                                <div style={{ ...valueStyle, fontStyle: 'italic', color: '#374151' }}>"{request.supervisor_remarks}"</div>
                            </div>
                        )}
                    </div>
                </Card>
            )}

            {/* Packing Progress + Stock Transfer Status */}
            {!isRejected && (canPack || isCompleted) && (
                <div style={{ marginTop: 16 }}>
                    <Card>
                        <div style={{
                            fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 12,
                            textTransform: 'uppercase', letterSpacing: '0.5px',
                            paddingBottom: 8, borderBottom: '1px solid #e5e7eb',
                        }}>
                            PACKING PROGRESS
                        </div>
                        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 12 }}>
                            <div>
                                <span style={{ fontSize: 12, color: '#6b7280' }}>Packed: </span>
                                <span style={{ fontWeight: 700, fontSize: 15, color: isFullyPacked ? '#16a34a' : '#d97706' }}>
                                    {totalBoxQty} / {totalQty}
                                </span>
                            </div>
                            <div>
                                <span style={{ fontSize: 12, color: '#6b7280' }}>Boxes: </span>
                                <span style={{ fontWeight: 700, fontSize: 15 }}>{boxes.length}</span>
                            </div>
                            <div>
                                <span style={{ fontSize: 12, color: '#6b7280' }}>Remaining: </span>
                                <span style={{ fontWeight: 700, fontSize: 15, color: remaining === 0 ? '#16a34a' : '#dc2626' }}>
                                    {remaining}
                                </span>
                            </div>
                            <div>
                                <span style={{ fontSize: 12, color: '#6b7280' }}>Stickers: </span>
                                <span style={{ fontWeight: 700, fontSize: 15 }}>
                                    {boxes.filter(b => b.sticker_printed).length} / {boxes.length} printed
                                </span>
                            </div>
                        </div>
                        {/* Packing Progress Bar */}
                        <div style={{ marginBottom: 4 }}>
                            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3, fontWeight: 600 }}>Packing</div>
                            <div style={{ height: 6, borderRadius: 3, backgroundColor: '#e5e7eb', overflow: 'hidden' }}>
                                <div style={{
                                    height: '100%', borderRadius: 3, transition: 'width 0.4s ease',
                                    width: `${progressPct}%`,
                                    background: isFullyPacked ? '#16a34a' : '#3b82f6',
                                }} />
                            </div>
                            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, textAlign: 'right' }}>
                                {progressPct}% packed
                            </div>
                        </div>
                        {/* Stock Transfer Progress Bar */}
                        <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3, fontWeight: 600 }}>Stock Transfer to Prod WHSE</div>
                            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 4 }}>
                                <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>
                                    {transferredQty} / {totalQty} PCS transferred
                                </span>
                                {hasUntransferred && (
                                    <span style={{
                                        fontSize: 11, color: '#d97706', fontWeight: 600,
                                        padding: '2px 8px', borderRadius: 3, background: '#fffbeb',
                                    }}>
                                        {untransferredQty} PCS ready to move
                                    </span>
                                )}
                            </div>
                            <div style={{ height: 6, borderRadius: 3, backgroundColor: '#e5e7eb', overflow: 'hidden' }}>
                                <div style={{
                                    height: '100%', borderRadius: 3, transition: 'width 0.4s ease',
                                    width: `${transferPct}%`,
                                    background: transferPct >= 100 ? '#16a34a' : '#d97706',
                                }} />
                            </div>
                            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, textAlign: 'right' }}>
                                {transferPct}% transferred to Prod WHSE
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {/* Start Packing CTA */}
            {isApproved && isOperator && (
                <div style={{
                    marginTop: 16, textAlign: 'center', padding: '28px 20px',
                    border: '1px dashed #3b82f6', borderRadius: 4, background: '#f8fafc',
                }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1e40af', marginBottom: 8 }}>
                        Movement approved — {totalQty} PCS ready for packing
                    </div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>
                        Stock is in <b>Production</b>. Start packing to split into boxes, generate stickers,
                    </div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                        and then transfer stock to <b>Prod WHSE</b> when ready.
                    </div>
                    <button onClick={handleStartPacking} disabled={submitting}
                        style={{
                            ...btnPrimary, padding: '12px 32px', fontSize: 14,
                            opacity: submitting ? 0.6 : 1,
                            cursor: submitting ? 'not-allowed' : 'pointer',
                        }}>
                        {submitting ? 'Starting...' : 'Start Packing'}
                    </button>
                </div>
            )}

            {/* Tabs */}
            {!isRejected && (canPack || isCompleted) && (
                <div style={{
                    display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb',
                    marginTop: 20, marginBottom: 0,
                }}>
                    {([
                        { key: 'boxes' as const, label: 'Boxes' },
                        { key: 'audit' as const, label: 'Activity Log' },
                    ]).map(tab => (
                        <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                            padding: '10px 20px', border: 'none', cursor: 'pointer',
                            fontSize: 13, fontWeight: activeTab === tab.key ? 700 : 500,
                            color: activeTab === tab.key ? '#1e3a8a' : '#6b7280',
                            borderBottom: activeTab === tab.key ? '2px solid #1e3a8a' : '2px solid transparent',
                            background: 'none', marginBottom: -2,
                        }}>
                            {tab.label}
                        </button>
                    ))}
                </div>
            )}

            {/* BOXES TAB */}
            {activeTab === 'boxes' && !isRejected && (canPack || isCompleted) && (
                <Card style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none' }}>
                    {/* Add Box Form */}
                    {canPack && isOperator && remaining > 0 && (
                        <div style={{
                            display: 'flex', gap: 10, alignItems: 'center',
                            padding: '12px 16px', borderBottom: '1px solid #e5e7eb',
                            backgroundColor: '#fafafa',
                        }}>
                            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
                                Add Box:
                            </label>
                            <input
                                type="number" min={1} max={remaining}
                                value={addQty || ''} onChange={e => setAddQty(Number(e.target.value))}
                                placeholder={`Qty (max ${remaining})`}
                                style={{
                                    width: 120, padding: '7px 12px', borderRadius: 3,
                                    border: '1px solid #d1d5db', fontSize: 13,
                                }}
                                onKeyDown={e => { if (e.key === 'Enter') handleAddBox(); }}
                            />
                            <button onClick={handleAddBox} disabled={submitting || addQty <= 0}
                                style={{
                                    ...btnPrimary,
                                    opacity: (submitting || addQty <= 0) ? 0.5 : 1,
                                    cursor: (submitting || addQty <= 0) ? 'not-allowed' : 'pointer',
                                }}>
                                {submitting ? 'Adding...' : 'Add'}
                            </button>
                            <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 'auto' }}>
                                Remaining: {remaining} PCS
                            </span>
                        </div>
                    )}

                    {/* Box Table */}
                    {boxes.length === 0 ? (
                        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                            {canPack ? 'No boxes yet. Use the form above to add boxes.' : 'No boxes recorded.'}
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        {['Box #', 'Packing ID', 'Quantity', 'Sticker', 'Transfer', 'Created', 'Actions'].map(h => (
                                            <th key={h} style={headerCellStyle}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {boxes.map(box => {
                                        const pkgId = box.packing_id || generatePackingId(box.id);
                                        return (
                                            <tr key={box.id}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                                                onMouseLeave={e => (e.currentTarget.style.background = '')}
                                            >
                                                <td style={{ ...cellStyle, fontWeight: 800, fontSize: 15, color: '#1e3a8a' }}>
                                                    #{box.box_number}
                                                </td>
                                                <td style={{ ...cellStyle, fontWeight: 700, fontSize: 12, color: '#7c3aed', fontFamily: 'monospace' }}>
                                                    {pkgId}
                                                </td>
                                                <td style={{ ...cellStyle, fontWeight: 600, fontSize: 14 }}>
                                                    {box.box_qty} PCS
                                                </td>
                                                <td style={cellStyle}>
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 700,
                                                        color: box.sticker_printed ? '#16a34a' : '#d97706',
                                                        backgroundColor: box.sticker_printed ? '#f0fdf4' : '#fffbeb',
                                                    }}>
                                                        {box.sticker_printed ? 'Printed' : 'Pending'}
                                                    </span>
                                                </td>
                                                <td style={cellStyle}>
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 700,
                                                        color: box.is_transferred ? '#16a34a' : '#6b7280',
                                                        backgroundColor: box.is_transferred ? '#f0fdf4' : '#f9fafb',
                                                    }}>
                                                        {box.is_transferred ? 'In Prod WHSE' : 'In Production'}
                                                    </span>
                                                </td>
                                                <td style={{ ...cellStyle, fontSize: 12, color: '#6b7280' }}>
                                                    {new Date(box.created_at).toLocaleString('en-IN')}
                                                </td>
                                                <td style={cellStyle}>
                                                    <div style={{ display: 'flex', gap: 6 }}>
                                                        {(canPack || isCompleted) && (
                                                            <button onClick={() => handlePrintSticker(box)}
                                                                style={btnBase}>
                                                                Print Sticker
                                                            </button>
                                                        )}
                                                        {canPack && isOperator && !box.sticker_printed && !box.is_transferred && (
                                                            <button onClick={() => handleDeleteBox(box.id)}
                                                                style={btnDanger}>
                                                                Delete
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
                                        <td style={{ ...cellStyle, fontWeight: 700, fontSize: 12 }}>TOTAL</td>
                                        <td style={cellStyle}></td>
                                        <td style={{ ...cellStyle, fontWeight: 700, fontSize: 14 }}>{totalBoxQty} PCS</td>
                                        <td style={{ ...cellStyle, fontSize: 12, fontWeight: 600 }}>
                                            {boxes.filter(b => b.sticker_printed).length} / {boxes.length} printed
                                        </td>
                                        <td style={{ ...cellStyle, fontSize: 12, fontWeight: 600 }}>
                                            {boxes.filter(b => b.is_transferred).length} / {boxes.length} transferred
                                        </td>
                                        <td colSpan={2}></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}

                    {/* Action Bar */}
                    {canPack && isOperator && boxes.length > 0 && (
                        <div style={{
                            padding: '14px 16px', borderTop: '1px solid #e5e7eb',
                            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                        }}>
                            {boxes.some(b => !b.sticker_printed) && (
                                <button onClick={handlePrintNextSticker} style={btnBase}>
                                    Print Next Sticker
                                </button>
                            )}

                            {/* Move Packed Stock Button — Partial Transfer */}
                            {hasUntransferred && (
                                <button onClick={handleMovePackedStock} disabled={submitting}
                                    style={{
                                        ...btnWarning,
                                        opacity: submitting ? 0.4 : 1,
                                        cursor: submitting ? 'not-allowed' : 'pointer',
                                    }}>
                                    {submitting ? 'Moving...' : `Move ${untransferredQty} PCS to Prod WHSE`}
                                </button>
                            )}

                            <div style={{ flex: 1 }} />

                            {!isFullyPacked && (
                                <span style={{ fontSize: 12, color: '#6b7280' }}>
                                    Split all {totalQty} PCS across boxes to complete.
                                </span>
                            )}
                            {isFullyPacked && !allStickersPrinted && (
                                <span style={{ fontSize: 12, color: '#d97706', fontWeight: 600 }}>
                                    Print all stickers before completing. ({boxes.filter(b => !b.sticker_printed).length} pending)
                                </span>
                            )}
                            <button onClick={handleCompletePacking} disabled={submitting || !canComplete}
                                style={{
                                    ...btnSuccess,
                                    padding: '10px 24px', fontSize: 13,
                                    opacity: (submitting || !canComplete) ? 0.4 : 1,
                                    cursor: (submitting || !canComplete) ? 'not-allowed' : 'pointer',
                                }}>
                                {submitting ? 'Completing...' : 'Complete Packing'}
                            </button>
                        </div>
                    )}
                </Card>
            )}

            {/* ACTIVITY LOG TAB — Human-readable, no UUIDs */}
            {activeTab === 'audit' && !isRejected && (
                <Card style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none' }}>
                    {auditLogs.length === 0 ? (
                        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                            No activity recorded yet.
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        {['Action', 'Performed By', 'Role', 'Timestamp', 'Details'].map(h => (
                                            <th key={h} style={headerCellStyle}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {auditLogs.map(log => (
                                        <tr key={log.id}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                                        >
                                            <td style={{ ...cellStyle, fontWeight: 600 }}>
                                                {AUDIT_ACTION_LABELS[log.action_type] || log.action_type}
                                            </td>
                                            <td style={cellStyle}>{log.performed_by_name || 'System'}</td>
                                            <td style={{ ...cellStyle, fontSize: 12 }}>{log.role || '—'}</td>
                                            <td style={{ ...cellStyle, fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                                                {new Date(log.created_at).toLocaleString('en-IN')}
                                            </td>
                                            <td style={{ ...cellStyle, fontSize: 12, color: '#374151', maxWidth: 400 }}>
                                                {formatAuditDetails(log.action_type, log.metadata)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            )}

            {/* Stock Transfer Confirmation Modal */}
            {showTransferConfirm && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: '#fff', borderRadius: 8, padding: 28, maxWidth: 520, width: '95%',
                        boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
                    }}>
                        {/* Header */}
                        <div style={{
                            fontSize: 16, fontWeight: 800, color: '#111827', marginBottom: 4,
                        }}>
                            {transferType === 'complete' ? 'Complete Packing & Transfer Stock' : 'Move Packed Stock to Prod WHSE'}
                        </div>
                        <div style={{
                            fontSize: 12, color: '#6b7280', marginBottom: 20,
                            borderBottom: '1px solid #e5e7eb', paddingBottom: 12,
                        }}>
                            Movement: {request.movement_number} | Item: {request.item_code}
                        </div>

                        {/* Transfer Details */}
                        <div style={{
                            padding: '16px', borderRadius: 6, marginBottom: 20,
                            background: transferType === 'complete' ? '#f0fdf4' : '#fffbeb',
                            border: `1px solid ${transferType === 'complete' ? '#86efac' : '#fcd34d'}`,
                        }}>
                            {transferType === 'complete' ? (
                                <>
                                    <div style={{ fontWeight: 700, fontSize: 14, color: '#166534', marginBottom: 8 }}>
                                        Final Transfer — All Remaining Stock
                                    </div>
                                    <div style={{ fontSize: 13, color: '#15803d', marginBottom: 4 }}>
                                        <b>{allBoxesTransferred ? 'All boxes already transferred.' : `${untransferredQty} PCS`}</b> will be moved from <b>Production</b> to <b>Prod WHSE</b>.
                                    </div>
                                    <div style={{ fontSize: 12, color: '#15803d' }}>
                                        This will complete packing — {totalQty} PCS total in {boxes.length} box(es).
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ fontWeight: 700, fontSize: 14, color: '#92400e', marginBottom: 8 }}>
                                        Partial Stock Transfer
                                    </div>
                                    <div style={{ fontSize: 13, color: '#92400e', marginBottom: 4 }}>
                                        <b>{untransferredQty} PCS</b> ({untransferredBoxes.length} box{untransferredBoxes.length > 1 ? 'es' : ''}) will be moved from <b>Production</b> to <b>Prod WHSE</b>.
                                    </div>
                                    <div style={{ fontSize: 12, color: '#92400e' }}>
                                        You can continue packing remaining items and transfer more later.
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Box Summary */}
                        <div style={{
                            fontSize: 12, color: '#6b7280', marginBottom: 16,
                            padding: '10px 14px', background: '#f9fafb', borderRadius: 4,
                            border: '1px solid #e5e7eb',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span>Total Approved:</span>
                                <span style={{ fontWeight: 700, color: '#111827' }}>{totalQty} PCS</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span>Already in Prod WHSE:</span>
                                <span style={{ fontWeight: 700, color: '#16a34a' }}>{transferredQty} PCS</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span>To Transfer Now:</span>
                                <span style={{ fontWeight: 700, color: '#d97706' }}>{untransferredQty} PCS</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e5e7eb', paddingTop: 4, marginTop: 4 }}>
                                <span>After Transfer:</span>
                                <span style={{ fontWeight: 700, color: '#111827' }}>{transferredQty + untransferredQty} / {totalQty} PCS in Prod WHSE</span>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => setShowTransferConfirm(false)} style={{
                                flex: 1, padding: '10px 16px', borderRadius: 4,
                                border: '1px solid #d1d5db', background: '#fff',
                                fontWeight: 600, cursor: 'pointer', fontSize: 13,
                                color: '#374151',
                            }}>Cancel</button>
                            <button onClick={handleConfirmTransfer} disabled={submitting} style={{
                                flex: 1, padding: '10px 16px', borderRadius: 4,
                                border: 'none',
                                background: transferType === 'complete' ? '#16a34a' : '#d97706',
                                color: '#fff',
                                fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 13,
                                opacity: submitting ? 0.6 : 1,
                            }}>
                                {submitting ? 'Processing...' : transferType === 'complete' ? 'Complete & Transfer Stock' : 'Move Stock to Prod WHSE'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Sticker Print Modal */}
            {stickerData && (
                <StickerPrint sticker={stickerData} onClose={() => setStickerData(null)} onPrinted={handleStickerPrinted} />
            )}
        </div>
    );
}
