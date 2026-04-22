/**
 * RackCellDrawer — side drawer shown when the user clicks a rack cell.
 * Shows the full back-chain (pallet → cartons → PL → invoice → BPA)
 * and allows "Move to another cell" action.
 */
import React, { useEffect, useState } from 'react';
import { X, ArrowRightLeft, MapPin, Package, FileText, Building2 } from 'lucide-react';
import { Card } from '../ui/EnterpriseUI';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { LoadingSpinner } from '../ui/EnterpriseUI';
import { getCellChain } from './rackService';
import type { RackCellChainResponse } from './types';
import { MovePalletDialog } from './MovePalletDialog';

interface Props {
    rackLocationId: string;
    onClose: () => void;
    onChanged?: () => void;
    canMove: boolean;
}

export function RackCellDrawer({ rackLocationId, onClose, onChanged, canMove }: Props) {
    const [data, setData] = useState<RackCellChainResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showMove, setShowMove] = useState(false);

    useEffect(() => {
        setLoading(true); setError(null);
        getCellChain({ rack_location_id: rackLocationId })
            .then(setData)
            .catch(e => setError(e?.message ?? 'Failed to load'))
            .finally(() => setLoading(false));
    }, [rackLocationId]);

    const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
        <div style={{ marginBottom: '10px' }}>
            <p style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--enterprise-gray-500)', marginBottom: '2px', fontWeight: 600 }}>{label}</p>
            <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-800)' }}>{value}</p>
        </div>
    );

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000 }} onClick={onClose}>
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    position: 'absolute', top: 0, right: 0, bottom: 0,
                    width: '480px', maxWidth: '95vw',
                    background: 'white',
                    boxShadow: '-2px 0 15px rgba(0,0,0,0.15)',
                    display: 'flex', flexDirection: 'column',
                }}
            >
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
                            <MapPin size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                            Cell {data?.cell.location_code ?? '—'}
                        </h2>
                        {data && (
                            <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', margin: '2px 0 0' }}>
                                {data.cell.warehouse_name} · Shipment {data.cell.shipment_sequence ?? '—'}
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
                    {loading && <div style={{ textAlign: 'center', padding: 40 }}><LoadingSpinner size={28} /></div>}
                    {error && <div style={{ color: '#991b1b', background: '#fef2f2', padding: 10, borderRadius: 6 }}>{error}</div>}

                    {data && (
                        <>
                            {/* Pallet */}
                            <SectionHeader icon={<Package size={14} />} label="Pallet" />
                            {data.cell.is_empty ? (
                                <div style={{ color: 'var(--enterprise-gray-500)', fontStyle: 'italic', marginBottom: '20px' }}>
                                    Empty cell — no pallet here.
                                </div>
                            ) : (
                                <>
                                    <Field label="Pallet #" value={<strong>{data.cell.pallet_number ?? '—'}</strong>} />
                                    <Field label="State" value={<Badge variant={(data.cell.pallet_state === 'IN_3PL_WAREHOUSE' ? 'success' : data.cell.pallet_state === 'RESERVED' ? 'warning' : 'neutral') as any}>{data.cell.pallet_state ?? '—'}</Badge>} />
                                    <Field label="Quantity" value={<strong>{(data.cell.pallet_quantity ?? 0).toLocaleString()}</strong>} />
                                    <Field label="Part" value={<>{data.cell.msn_code} <span style={{ color: 'var(--enterprise-gray-500)' }}>({data.cell.part_number})</span></>} />
                                    <Field label="Item Name" value={data.cell.item_name ?? '—'} />
                                    <Field label="Placed" value={data.cell.placed_at ? `${new Date(data.cell.placed_at).toLocaleString()} · ${data.cell.days_in_rack ?? 0} days ago` : '—'} />

                                    {/* Cartons summary */}
                                    {data.cartons.length > 0 && (
                                        <Field label="Inner Boxes" value={
                                            <div>
                                                <strong>{data.cartons.length}</strong> carton(s)
                                                <details style={{ marginTop: '4px' }}>
                                                    <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--enterprise-primary)' }}>Show</summary>
                                                    <ul style={{ marginTop: '4px', fontSize: '12px', paddingLeft: '18px' }}>
                                                        {data.cartons.map((c: any) => (
                                                            <li key={c.id}>
                                                                {c.container_number ?? c.id} · qty {c.quantity ?? '—'}
                                                                {c.work_order_id && <span style={{ color: 'var(--enterprise-gray-500)' }}> · WO {c.work_order_id}</span>}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </details>
                                            </div>
                                        } />
                                    )}
                                </>
                            )}

                            {/* Packing List */}
                            <SectionHeader icon={<FileText size={14} />} label="Packing List" />
                            <Field label="PL Number" value={data.cell.packing_list_number ?? '—'} />

                            {/* Invoice */}
                            <SectionHeader icon={<FileText size={14} />} label="Invoice" />
                            <Field label="Invoice #" value={data.cell.parent_invoice_number ?? '—'} />
                            {data.invoice && (
                                <>
                                    <Field label="Invoice Date" value={(data.invoice as any).invoice_date ? new Date((data.invoice as any).invoice_date).toLocaleDateString() : '—'} />
                                    <Field label="Status" value={(data.invoice as any).status ?? '—'} />
                                </>
                            )}

                            {/* Blanket Order */}
                            <SectionHeader icon={<Building2 size={14} />} label="Blanket Order" />
                            <Field label="BO Number" value={data.cell.blanket_order_number ?? '—'} />

                            {/* Agreement */}
                            <SectionHeader icon={<Building2 size={14} />} label="BPA" />
                            <Field label="Agreement #" value={data.cell.agreement_number ?? '—'} />
                            <Field label="Customer" value={data.cell.customer_name ?? '—'} />
                            <Field label="Buyer" value={data.cell.buyer_name ?? '—'} />

                            {/* Move history */}
                            {data.move_history.length > 1 && (
                                <>
                                    <SectionHeader icon={<ArrowRightLeft size={14} />} label={`Move History (${data.move_history.length})`} />
                                    <div style={{ fontSize: '12px' }}>
                                        {data.move_history.map(h => (
                                            <div key={h.id} style={{ padding: '4px 0', borderBottom: '1px dotted var(--enterprise-gray-200)' }}>
                                                <strong>{h.location_code}</strong> — {h.placed_at ? new Date(h.placed_at).toLocaleString() : '—'}
                                                {h.move_reason && <span style={{ color: 'var(--enterprise-gray-500)' }}> · {h.move_reason}</span>}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>

                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <Button variant="outline" onClick={onClose}>Close</Button>
                    {canMove && data && !data.cell.is_empty && (
                        <Button onClick={() => setShowMove(true)}>
                            <ArrowRightLeft size={14} style={{ marginRight: '6px' }} /> Move
                        </Button>
                    )}
                </div>
            </div>

            {showMove && data && data.cell.pallet_id && (
                <MovePalletDialog
                    palletId={data.cell.pallet_id}
                    palletNumber={data.cell.pallet_number ?? ''}
                    warehouseId={data.cell.warehouse_id}
                    currentLocationCode={data.cell.location_code}
                    onClose={() => setShowMove(false)}
                    onMoved={() => { setShowMove(false); onChanged?.(); }}
                />
            )}
        </div>
    );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '14px 0 6px', paddingBottom: '3px', borderBottom: '1px solid var(--enterprise-gray-200)', color: 'var(--enterprise-gray-600)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {icon}{label}
        </div>
    );
}
