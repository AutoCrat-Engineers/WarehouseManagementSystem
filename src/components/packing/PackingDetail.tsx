/**
 * PackingDetail — Sticker Generation Detail View (v9 — Refactored).
 *
 * PURPOSE: Auto-generates boxes and stickers based on approved qty & packing spec.
 * 
 * REMOVED (v9):
 *   - Manual "Add Box" form
 *   - "Start Packing" CTA button
 *   - Packing Progress bar
 *   - Partial stock transfer ("Move Packed Stock")
 *   - "Complete Packing" button
 *
 * NEW WORKFLOW (v9):
 *   1. On open → auto-generates box rows (Box Qty = total / inner_qty_per_box)
 *   2. Table shows: Unique Box ID, Movement ID, Serial #, Qty/Box, Print Status
 *   3. "Print Sticker" per row + "Print All Stickers" batch button
 *   4. "Move to FI Warehouse" enabled ONLY when all stickers are printed
 *   5. Stock moves ONLY after print is complete (core business rule)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/EnterpriseUI';
import { StickerPrint } from './StickerPrint';
import { Printer } from 'lucide-react';
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
    const [generating, setGenerating] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
    const [stickerData, setStickerData] = useState<StickerData | null>(null);
    const [activeTab, setActiveTab] = useState<'stickers' | 'audit'>('stickers');
    const [showTransferConfirm, setShowTransferConfirm] = useState(false);
    const [printQueue, setPrintQueue] = useState<StickerData[]>([]);
    const [isBatchPrinting, setIsBatchPrinting] = useState(false);

    // ============================================================================
    // DATA LOADING
    // ============================================================================

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch request
            const { data: reqData, error: reqErr } = await supabase
                .from('packing_requests').select('*').eq('id', requestId).single();
            if (reqErr) throw reqErr;

            // Fetch item info
            const { data: itemData } = await supabase
                .from('items').select('item_name, part_number, master_serial_no, revision')
                .eq('item_code', reqData.item_code).single();

            // Fetch profiles
            const profileIds = [reqData.created_by, reqData.approved_by].filter(Boolean);
            let nameMap: Record<string, string> = {};
            if (profileIds.length) {
                const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', profileIds);
                (profiles || []).forEach((p: any) => { nameMap[p.id] = p.full_name; });
            }

            const enrichedReq: PackingRequest = {
                ...reqData,
                item_name: itemData?.item_name || reqData.item_code,
                part_number: itemData?.part_number || null,
                master_serial_no: itemData?.master_serial_no || null,
                revision: itemData?.revision || null,
                created_by_name: nameMap[reqData.created_by] || undefined,
                approved_by_name: reqData.approved_by ? nameMap[reqData.approved_by] : undefined,
            };
            setRequest(enrichedReq);

            // Fetch boxes
            const boxesData = await svc.fetchBoxesForRequest(requestId);
            setBoxes(boxesData);

            // Fetch audit logs
            const auditData = await svc.fetchAuditLogs(requestId);
            setAuditLogs(auditData);

        } catch (err: any) {
            console.error('Error loading packing data:', err);
            setMessage({ type: 'error', text: err.message || 'Failed to load data' });
        } finally {
            setLoading(false);
        }
    }, [requestId, supabase]);

    useEffect(() => { loadData(); }, [loadData]);

    // ============================================================================
    // AUTO-GENERATE BOXES (on first open for APPROVED requests)
    // ============================================================================

    useEffect(() => {
        if (!request || loading) return;
        if (request.status === 'APPROVED' && boxes.length === 0) {
            handleAutoGenerate();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request?.id, request?.status, loading]);

    const handleAutoGenerate = async () => {
        if (generating) return;
        setGenerating(true);
        setMessage(null);
        try {
            const generatedBoxes = await svc.autoGenerateBoxes(requestId);
            setBoxes(generatedBoxes);
            // Reload full data to get updated status
            await loadData();
            setMessage({ type: 'success', text: `Auto-generated ${generatedBoxes.length} box sticker(s) based on packing specifications.` });
        } catch (err: any) {
            console.error('Auto-generate failed:', err);
            setMessage({ type: 'error', text: err.message || 'Failed to auto-generate boxes' });
        } finally {
            setGenerating(false);
        }
    };

    // ============================================================================
    // STICKER ACTIONS
    // ============================================================================

    const handlePrintSticker = (box: PackingBox) => {
        if (!request) return;
        const sticker: StickerData = {
            packingId: box.packing_id || generatePackingId(box.id),
            partNumber: request.part_number || '—',
            description: request.item_name || request.item_code,
            mslNo: request.master_serial_no || '—',
            revision: request.revision || '—',
            movementNumber: request.movement_number,
            packingRequestId: request.id,
            boxNumber: box.box_number,
            totalBoxes: boxes.length,
            boxQuantity: box.box_qty,
            totalQuantity: Number(request.total_packed_qty),
            packingDate: new Date().toISOString().split('T')[0],
            itemCode: request.item_code,
            operatorName: currentUserName || 'System',
        };
        setStickerData(sticker);
    };

    const handleStickerPrinted = async () => {
        const box = boxes.find(b => (b.packing_id || generatePackingId(b.id)) === stickerData?.packingId);
        if (!box) return;
        try {
            await svc.markStickerPrinted(requestId, box.id);
            setStickerData(null);
            await loadData();
            setMessage({ type: 'success', text: `Sticker printed for Box #${box.box_number} (${box.packing_id})` });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Failed to mark sticker as printed' });
        }
    };

    const handlePrintAllStickers = () => {
        if (!request) return;
        // Build sticker data for all unprinted + non-transferred boxes
        const eligibleForPrint = boxes.filter(b => !b.sticker_printed && !b.is_transferred);
        if (eligibleForPrint.length === 0) {
            setMessage({ type: 'info', text: 'All stickers are already printed.' });
            return;
        }
        const queue: StickerData[] = eligibleForPrint.map(box => ({
            packingId: box.packing_id || generatePackingId(box.id),
            partNumber: request.part_number || '—',
            description: request.item_name || request.item_code,
            mslNo: request.master_serial_no || '—',
            revision: request.revision || '—',
            movementNumber: request.movement_number,
            packingRequestId: request.id,
            boxNumber: box.box_number,
            totalBoxes: boxes.length,
            boxQuantity: box.box_qty,
            totalQuantity: Number(request.total_packed_qty),
            packingDate: new Date().toISOString().split('T')[0],
            itemCode: request.item_code,
            operatorName: currentUserName || 'System',
        }));
        // Set first sticker and queue the rest
        setStickerData(queue[0]);
        setPrintQueue(queue.slice(1));
        setIsBatchPrinting(true);
        setMessage({ type: 'info', text: `Printing ${queue.length} sticker(s)... Complete each print to continue.` });
    };

    // Handle sequential print queue — after one sticker is printed, open the next
    const handleQueuedStickerPrinted = async () => {
        const box = boxes.find(b => (b.packing_id || generatePackingId(b.id)) === stickerData?.packingId);
        if (box) {
            try {
                await svc.markStickerPrinted(requestId, box.id);
            } catch (err: any) {
                setMessage({ type: 'error', text: err.message || 'Failed to mark sticker as printed' });
            }
        }
        if (printQueue.length > 0) {
            // Open next sticker in queue
            setStickerData(printQueue[0]);
            setPrintQueue(prev => prev.slice(1));
        } else {
            // Queue complete
            setStickerData(null);
            setIsBatchPrinting(false);
            await loadData();
            setMessage({ type: 'success', text: `All stickers printed successfully.` });
        }
    };

    // ============================================================================
    // MOVE TO FI WAREHOUSE — Partial/Full stock transfer
    // Transfers all PRINTED + NOT YET TRANSFERRED boxes
    // ============================================================================

    const handleMoveToFIWarehouse = () => {
        setShowTransferConfirm(true);
    };

    const handleConfirmTransfer = async () => {
        setSubmitting(true);
        setMessage(null);
        try {
            // Transfer all printed but untransferred boxes
            const result = await svc.transferPackedStock(requestId);
            setShowTransferConfirm(false);
            await loadData();

            if (result.isComplete) {
                setMessage({ type: 'success', text: `All stock moved to FI Warehouse — ${result.transferredQty} PCS in ${result.boxesTransferred} box(es). Record is now completed.` });
            } else {
                setMessage({ type: 'success', text: `Transferred ${result.transferredQty} PCS (${result.boxesTransferred} box(es)) to FI Warehouse. Print remaining stickers to transfer more.` });
            }
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Failed to move stock to FI Warehouse' });
        } finally {
            setSubmitting(false);
        }
    };

    // ============================================================================
    // COMPUTED VALUES
    // ============================================================================

    if (loading || !request) {
        return (
            <div style={{ padding: 48, textAlign: 'center' }}>
                <div style={{
                    width: 36, height: 36, border: '3px solid #e5e7eb', borderTopColor: '#1e3a8a',
                    borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
                }} />
                <div style={{ fontSize: 14, color: '#6b7280' }}>Loading sticker data...</div>
                <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    const statusCfg = PACKING_STATUS_CONFIG[request.status] || { color: '#6b7280', bg: '#f3f4f6', label: request.status };
    const isCompleted = request.status === 'COMPLETED';
    const isRejected = request.status === 'REJECTED';

    const totalQty = Number(request.total_packed_qty);
    const allStickersPrinted = boxes.length > 0 && boxes.every(b => b.sticker_printed);
    const unprintedCount = boxes.filter(b => !b.sticker_printed).length;
    const printedCount = boxes.filter(b => b.sticker_printed).length;
    const transferredCount = boxes.filter(b => b.is_transferred).length;

    // Eligible boxes = sticker printed + not yet transferred
    const eligibleBoxes = boxes.filter(b => b.sticker_printed && !b.is_transferred);
    const eligibleQty = eligibleBoxes.reduce((s, b) => s + Number(b.box_qty), 0);

    // "Move to FI Warehouse" is enabled when:
    // 1. Status is NOT completed or rejected
    // 2. At least 1 box has its sticker PRINTED and is NOT yet transferred
    const canMoveToFI = !isCompleted && !isRejected && eligibleBoxes.length > 0;

    // ============================================================================
    // STYLES
    // ============================================================================

    const sectionTitleStyle: React.CSSProperties = {
        fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase',
        letterSpacing: '0.8px', marginBottom: 12, paddingBottom: 8,
        borderBottom: '2px solid #e5e7eb',
    };
    const headerCellStyle: React.CSSProperties = {
        padding: '10px 14px', textAlign: 'left', fontSize: 11,
        fontWeight: 700, color: '#374151', textTransform: 'uppercase',
        letterSpacing: '0.4px', borderBottom: '2px solid #e5e7eb',
        whiteSpace: 'nowrap', background: '#f9fafb',
    };
    const cellStyle: React.CSSProperties = {
        padding: '10px 14px', fontSize: 13, color: '#111827',
        borderBottom: '1px solid #f3f4f6',
    };
    const infoLabelStyle: React.CSSProperties = {
        fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase',
        letterSpacing: '0.3px', marginBottom: 3,
    };
    const infoValueStyle: React.CSSProperties = {
        fontSize: 13, fontWeight: 600, color: '#111827',
    };

    return (
        <div style={{ marginTop: -32 }}>
            {/* STICKY HEADER BAR */}
            <div style={{
                position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#fff',
                border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 20px',
                marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 16,
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}>
                <button onClick={onBack} style={{
                    padding: '6px 14px', borderRadius: 6, border: '1px solid #d1d5db',
                    background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 4,
                }}>
                    ← Back
                </button>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', fontFamily: 'monospace' }}>
                        {request.movement_number}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                        Sticker Generation — {request.item_name || request.item_code}
                    </div>
                </div>
                <span style={{
                    padding: '4px 14px', borderRadius: 12, fontSize: 11,
                    fontWeight: 600, color: statusCfg.color, backgroundColor: statusCfg.bg,
                    border: `1px solid ${statusCfg.color}30`, textTransform: 'uppercase',
                    letterSpacing: '0.3px', minWidth: 95, display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center',
                }}>
                    {statusCfg.label}
                </span>
            </div>

            {/* MESSAGE BANNER */}
            {message && (
                <div style={{
                    margin: '12px 0', padding: '12px 16px', borderRadius: 8,
                    background: message.type === 'error' ? '#fef2f2' : message.type === 'success' ? '#f0fdf4' : '#eff6ff',
                    color: message.type === 'error' ? '#dc2626' : message.type === 'success' ? '#16a34a' : '#2563eb',
                    border: `1px solid ${message.type === 'error' ? '#fecaca' : message.type === 'success' ? '#bbf7d0' : '#bfdbfe'}`,
                    fontSize: 13, fontWeight: 500,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <span>{message.text}</span>
                    <button onClick={() => setMessage(null)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
                        color: 'inherit', fontWeight: 700, padding: '0 4px',
                    }}>×</button>
                </div>
            )}

            {/* COMPLETED BANNER */}
            {isCompleted && (
                <div style={{
                    margin: '16px 0 0', padding: '12px 16px', borderRadius: 6,
                    background: '#fff', border: '1px solid #e5e7eb',
                    borderLeft: '4px solid #16a34a',
                    display: 'flex', alignItems: 'center', gap: 10,
                }}>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                            Completed — All Stock in FI Warehouse
                        </div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>
                            {totalQty} PCS transferred on {request.completed_at ? new Date(request.completed_at).toLocaleString('en-IN') : '—'}. This record is locked.
                        </div>
                    </div>
                </div>
            )}

            {/* GENERATING BANNER */}
            {generating && (
                <div style={{
                    margin: '12px 0', padding: '14px 18px', borderRadius: 8,
                    background: '#eff6ff', border: '1px solid #bfdbfe',
                    display: 'flex', alignItems: 'center', gap: 10,
                }}>
                    <div style={{
                        width: 20, height: 20, border: '2px solid #93c5fd', borderTopColor: '#1e3a8a',
                        borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                    }} />
                    <span style={{ fontSize: 13, color: '#1e40af', fontWeight: 600 }}>
                        Auto-generating box stickers from packing specifications...
                    </span>
                </div>
            )}

            {/* DOCUMENT DETAILS */}
            {!isRejected && (
                <Card style={{ marginTop: 16 }}>
                    {/* Item Information */}
                    <div style={{ marginBottom: 20 }}>
                        <div style={sectionTitleStyle}>Item Information</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px 24px' }}>
                            <div>
                                <div style={infoLabelStyle}>Item Code</div>
                                <div style={{ ...infoValueStyle, fontFamily: 'monospace' }}>{request.item_code}</div>
                            </div>
                            <div>
                                <div style={infoLabelStyle}>Description</div>
                                <div style={infoValueStyle}>{request.item_name || '—'}</div>
                            </div>
                            <div>
                                <div style={infoLabelStyle}>Part Number</div>
                                <div style={{ ...infoValueStyle, fontFamily: 'monospace' }}>{request.part_number || '—'}</div>
                            </div>
                            <div>
                                <div style={infoLabelStyle}>MSL No</div>
                                <div style={{ ...infoValueStyle, fontFamily: 'monospace' }}>{request.master_serial_no || '—'}</div>
                            </div>
                            <div>
                                <div style={infoLabelStyle}>Revision</div>
                                <div style={infoValueStyle}>{request.revision || '—'}</div>
                            </div>
                        </div>
                    </div>

                    {/* Approval & Authorization */}
                    <div>
                        <div style={sectionTitleStyle}>Approval & Authorization</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px 24px' }}>
                            <div>
                                <div style={infoLabelStyle}>Requested By</div>
                                <div style={infoValueStyle}>{request.created_by_name || '—'}</div>
                            </div>
                            <div>
                                <div style={infoLabelStyle}>Created</div>
                                <div style={{ fontSize: 12, color: '#6b7280' }}>
                                    {request.created_at ? new Date(request.created_at).toLocaleString('en-IN') : '—'}
                                </div>
                            </div>
                            <div>
                                <div style={infoLabelStyle}>Approved By</div>
                                <div style={infoValueStyle}>{request.approved_by_name || '—'}</div>
                            </div>
                            <div>
                                <div style={infoLabelStyle}>Approved Qty</div>
                                <div style={{ ...infoValueStyle, color: '#1e40af', fontSize: 16 }}>
                                    {totalQty} PCS
                                </div>
                            </div>
                            <div>
                                <div style={infoLabelStyle}>Supervisor Remarks</div>
                                <div style={{ fontSize: 12, color: '#6b7280' }}>
                                    {request.supervisor_remarks || '—'}
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            )}

            {/* STICKER SUMMARY */}
            {!isRejected && boxes.length > 0 && (
                <Card style={{ marginTop: 12 }}>
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: 16,
                    }}>
                        <div style={{
                            padding: '14px 16px', borderRadius: 8, background: '#eff6ff',
                            border: '1px solid #bfdbfe', textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#1e40af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>TOTAL BOXES</div>
                            <div style={{ fontSize: 24, fontWeight: 800, color: '#1e3a8a' }}>{boxes.length}</div>
                        </div>
                        <div style={{
                            padding: '14px 16px', borderRadius: 8, background: '#f0fdf4',
                            border: '1px solid #bbf7d0', textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>PRINTED</div>
                            <div style={{ fontSize: 24, fontWeight: 800, color: '#166534' }}>{printedCount}</div>
                        </div>
                        <div style={{
                            padding: '14px 16px', borderRadius: 8, background: '#fef2f2',
                            border: '1px solid #fecaca', textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>PENDING</div>
                            <div style={{ fontSize: 24, fontWeight: 800, color: '#991b1b' }}>{unprintedCount}</div>
                        </div>
                        <div style={{
                            padding: '14px 16px', borderRadius: 8, background: '#f9fafb',
                            border: '1px solid #e5e7eb', textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>TOTAL QTY</div>
                            <div style={{ fontSize: 24, fontWeight: 800, color: '#111827' }}>{totalQty}</div>
                        </div>
                    </div>
                </Card>
            )}

            {/* TABS */}
            {!isRejected && boxes.length > 0 && (
                <div style={{
                    display: 'flex', gap: 0, marginTop: 16,
                    borderBottom: '2px solid #e5e7eb',
                }}>
                    <button onClick={() => setActiveTab('stickers')} style={{
                        padding: '10px 20px', border: 'none', cursor: 'pointer',
                        fontSize: 13, fontWeight: activeTab === 'stickers' ? 700 : 500,
                        color: activeTab === 'stickers' ? '#1e3a8a' : '#6b7280',
                        background: 'none',
                        borderBottom: activeTab === 'stickers' ? '2px solid #1e3a8a' : '2px solid transparent',
                        marginBottom: -2,
                    }}>
                        Stickers ({boxes.length})
                    </button>
                    <button onClick={() => setActiveTab('audit')} style={{
                        padding: '10px 20px', border: 'none', cursor: 'pointer',
                        fontSize: 13, fontWeight: activeTab === 'audit' ? 700 : 500,
                        color: activeTab === 'audit' ? '#1e3a8a' : '#6b7280',
                        background: 'none',
                        borderBottom: activeTab === 'audit' ? '2px solid #1e3a8a' : '2px solid transparent',
                        marginBottom: -2,
                    }}>
                        Activity Log ({auditLogs.length})
                    </button>
                </div>
            )}

            {/* STICKERS TAB */}
            {activeTab === 'stickers' && !isRejected && boxes.length > 0 && (
                <Card style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none' }}>
                    {/* Sticker Table */}
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                            <colgroup>
                                <col style={{ width: '5%' }} />
                                <col style={{ width: '16%' }} />
                                <col style={{ width: '16%' }} />
                                <col style={{ width: '7%' }} />
                                <col style={{ width: '10%' }} />
                                <col style={{ width: '13%' }} />
                                <col style={{ width: '15%' }} />
                                <col style={{ width: '12%' }} />
                            </colgroup>
                            <thead>
                                <tr>
                                    <th style={{ ...headerCellStyle, textAlign: 'center' }}>S.No</th>
                                    <th style={headerCellStyle}>Unique Box ID</th>
                                    <th style={headerCellStyle}>Movement ID</th>
                                    <th style={{ ...headerCellStyle, textAlign: 'center' }}>Box #</th>
                                    <th style={{ ...headerCellStyle, textAlign: 'right' }}>Qty / Box</th>
                                    <th style={{ ...headerCellStyle, textAlign: 'center' }}>Print Status</th>
                                    <th style={{ ...headerCellStyle, textAlign: 'center' }}>Transfer</th>
                                    <th style={{ ...headerCellStyle, textAlign: 'center' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {boxes.map((box, idx) => {
                                    const packingId = box.packing_id || generatePackingId(box.id);
                                    const isPrinted = box.sticker_printed;
                                    const isTransferred = box.is_transferred;

                                    return (
                                        <tr key={box.id}
                                            onMouseEnter={e => { e.currentTarget.style.background = '#fafafa'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                                        >
                                            <td style={{ ...cellStyle, textAlign: 'center', fontWeight: 600, color: '#6b7280' }}>
                                                {idx + 1}
                                            </td>
                                            <td style={{ ...cellStyle, fontWeight: 700, fontFamily: 'monospace', color: '#1e3a8a' }}>
                                                {packingId}
                                            </td>
                                            <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                                                {request.movement_number}
                                            </td>
                                            <td style={{ ...cellStyle, textAlign: 'center', fontWeight: 600 }}>
                                                {box.box_number}
                                            </td>
                                            <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
                                                {box.box_qty} PCS
                                            </td>
                                            <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                {isPrinted ? (
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                        padding: '3px 10px', borderRadius: 12,
                                                        background: '#f0fdf4', color: '#16a34a',
                                                        fontSize: 11, fontWeight: 600,
                                                        border: '1px solid #bbf7d0', minWidth: 80, justifyContent: 'center',
                                                    }}>
                                                        Printed
                                                    </span>
                                                ) : (
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                        padding: '3px 10px', borderRadius: 12,
                                                        background: '#fef2f2', color: '#dc2626',
                                                        fontSize: 11, fontWeight: 600,
                                                        border: '1px solid #fecaca', minWidth: 80, justifyContent: 'center',
                                                    }}>
                                                        Pending
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                {isTransferred ? (
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                        padding: '3px 10px', borderRadius: 12,
                                                        background: '#f0fdf4', color: '#166534',
                                                        fontSize: 11, fontWeight: 600,
                                                        border: '1px solid #86efac', minWidth: 80, justifyContent: 'center',
                                                    }}>
                                                        In FI Warehouse
                                                    </span>
                                                ) : isPrinted ? (
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                        padding: '3px 10px', borderRadius: 12,
                                                        background: '#eff6ff', color: '#1e40af',
                                                        fontSize: 11, fontWeight: 600,
                                                        border: '1px solid #93c5fd', minWidth: 80, justifyContent: 'center',
                                                    }}>
                                                        Ready to Move
                                                    </span>
                                                ) : (
                                                    <span style={{ fontSize: 11, color: '#9ca3af' }}>—</span>
                                                )}
                                            </td>
                                            <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                <button
                                                    onClick={() => handlePrintSticker(box)}
                                                    disabled={false}
                                                    style={{
                                                        padding: '5px 14px', borderRadius: 5, border: 'none',
                                                        background: isPrinted ? '#e5e7eb' : '#1e3a8a',
                                                        color: isPrinted ? '#374151' : '#fff',
                                                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                                        opacity: 1,
                                                        transition: 'all 0.15s',
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                    }}
                                                >
                                                    <Printer size={13} /> {isPrinted ? 'Reprint' : 'Print'}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr style={{ background: '#f9fafb' }}>
                                    <td colSpan={4} style={{ ...cellStyle, fontWeight: 700, borderTop: '2px solid #e5e7eb' }}>
                                        TOTAL — {boxes.length} Box{boxes.length !== 1 ? 'es' : ''}
                                    </td>
                                    <td style={{ ...cellStyle, fontWeight: 800, textAlign: 'right', fontFamily: 'monospace', borderTop: '2px solid #e5e7eb' }}>
                                        {boxes.reduce((s, b) => s + Number(b.box_qty), 0)} PCS
                                    </td>
                                    <td style={{ ...cellStyle, fontWeight: 600, textAlign: 'center', borderTop: '2px solid #e5e7eb' }}>
                                        {printedCount}/{boxes.length}
                                    </td>
                                    <td style={{ ...cellStyle, fontWeight: 600, textAlign: 'center', borderTop: '2px solid #e5e7eb' }}>
                                        {transferredCount}/{boxes.length}
                                    </td>
                                    <td style={{ ...cellStyle, borderTop: '2px solid #e5e7eb' }}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* ACTION BAR */}
                    {!isCompleted && (
                        <div style={{
                            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
                            gap: 12, padding: '16px 0 4px',
                            borderTop: '1px solid #e5e7eb', marginTop: 8,
                        }}>
                            {/* Print All Stickers */}
                            {unprintedCount > 0 && (
                                <button onClick={handlePrintAllStickers} disabled={submitting}
                                    style={{
                                        padding: '10px 20px', borderRadius: 6, border: 'none',
                                        background: '#7c3aed', color: '#fff',
                                        fontSize: 13, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                                        opacity: submitting ? 0.5 : 1, transition: 'all 0.15s',
                                        display: 'flex', alignItems: 'center', gap: 6,
                                    }}
                                >
                                    <Printer size={14} /> {submitting ? 'Printing...' : `Print All (${unprintedCount})`}
                                </button>
                            )}

                            <div style={{ flex: 1 }} />

                            {/* Status Message */}
                            {eligibleBoxes.length > 0 && (
                                <span style={{ fontSize: 12, color: '#1e40af', fontWeight: 600 }}>
                                    {eligibleBoxes.length} box(es) ({eligibleQty} PCS) ready to move to FI Warehouse.
                                </span>
                            )}
                            {eligibleBoxes.length === 0 && unprintedCount > 0 && (
                                <span style={{ fontSize: 12, color: '#d97706', fontWeight: 600 }}>
                                    Print sticker(s) to enable warehouse transfer.
                                </span>
                            )}
                            {eligibleBoxes.length === 0 && unprintedCount === 0 && transferredCount === boxes.length && (
                                <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                                    All boxes transferred to FI Warehouse.
                                </span>
                            )}

                            {/* Move to FI Warehouse Button */}
                            <button onClick={handleMoveToFIWarehouse}
                                disabled={!canMoveToFI || submitting}
                                style={{
                                    padding: '10px 24px', borderRadius: 6, border: 'none',
                                    background: canMoveToFI ? '#16a34a' : '#e5e7eb',
                                    color: canMoveToFI ? '#fff' : '#9ca3af',
                                    fontSize: 13, fontWeight: 800, letterSpacing: '0.3px',
                                    cursor: (canMoveToFI && !submitting) ? 'pointer' : 'not-allowed',
                                    opacity: submitting ? 0.5 : 1, transition: 'all 0.15s',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}
                            >
                                {submitting ? 'Moving...' : `Move to FI Warehouse (${eligibleBoxes.length})`}
                            </button>
                        </div>
                    )}
                </Card>
            )}

            {/* ACTIVITY LOG TAB */}
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

            {/* TRANSFER CONFIRMATION MODAL */}
            {showTransferConfirm && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: '#fff', borderRadius: 12, padding: 28, maxWidth: 520, width: '95%',
                        boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
                    }}>
                        {/* Header */}
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
                            Move Stock to FI Warehouse
                        </div>
                        <div style={{
                            fontSize: 12, color: '#6b7280', marginBottom: 20,
                            borderBottom: '1px solid #e5e7eb', paddingBottom: 12,
                        }}>
                            Movement: {request.movement_number} | Item: {request.item_code}
                        </div>

                        {/* Transfer Details */}
                        <div style={{
                            padding: '16px', borderRadius: 8, marginBottom: 20,
                            background: '#f0fdf4', border: '1px solid #86efac',
                        }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#166534', marginBottom: 8 }}>
                                Stock Transfer — {eligibleBoxes.length} Printed Box(es)
                            </div>
                            <div style={{ fontSize: 13, color: '#15803d', marginBottom: 4 }}>
                                <b>{eligibleQty} PCS</b> in <b>{eligibleBoxes.length} box(es)</b> will be moved from <b>Production</b> to <b>FI Warehouse</b>.
                            </div>
                            <div style={{ fontSize: 12, color: '#15803d' }}>
                                {eligibleBoxes.length === boxes.length - transferredCount
                                    ? 'This will transfer all remaining boxes and complete the record.'
                                    : `${unprintedCount} box(es) still have pending stickers. You can transfer them after printing.`
                                }
                            </div>
                        </div>

                        {/* Summary */}
                        <div style={{
                            fontSize: 12, color: '#6b7280', marginBottom: 16,
                            padding: '10px 14px', background: '#f9fafb', borderRadius: 6,
                            border: '1px solid #e5e7eb',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span>Total Approved:</span>
                                <span style={{ fontWeight: 700, color: '#111827' }}>{totalQty} PCS</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span>Ready to Transfer:</span>
                                <span style={{ fontWeight: 700, color: '#1e40af' }}>{eligibleBoxes.length} box(es) — {eligibleQty} PCS</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span>Already Transferred:</span>
                                <span style={{ fontWeight: 700, color: '#16a34a' }}>{transferredCount} box(es)</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span>Pending Print:</span>
                                <span style={{ fontWeight: 700, color: '#d97706' }}>{unprintedCount} box(es)</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e5e7eb', paddingTop: 4, marginTop: 4 }}>
                                <span>Destination:</span>
                                <span style={{ fontWeight: 700, color: '#1e3a8a' }}>FI Warehouse</span>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => setShowTransferConfirm(false)} style={{
                                flex: 1, padding: '10px 16px', borderRadius: 6,
                                border: '1px solid #d1d5db', background: '#fff',
                                fontWeight: 600, cursor: 'pointer', fontSize: 13,
                                color: '#374151',
                            }}>Cancel</button>
                            <button onClick={handleConfirmTransfer} disabled={submitting} style={{
                                flex: 1, padding: '10px 16px', borderRadius: 6,
                                border: 'none', background: '#16a34a', color: '#fff',
                                fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 13,
                                opacity: submitting ? 0.6 : 1,
                            }}>
                                {submitting ? 'Processing...' : 'Confirm & Move Stock'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Sticker Print Modal */}
            {stickerData && (
                <StickerPrint sticker={stickerData} onClose={() => { setStickerData(null); setPrintQueue([]); setIsBatchPrinting(false); }} onPrinted={isBatchPrinting ? handleQueuedStickerPrinted : handleStickerPrinted} />
            )}

            {/* Spinner CSS */}
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
