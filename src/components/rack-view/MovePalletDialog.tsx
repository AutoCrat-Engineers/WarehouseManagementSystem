/**
 * MovePalletDialog — atomically move a placed pallet to a different cell.
 * Shows only cells that are currently empty; mandatory reason code.
 */
import React, { useEffect, useState } from 'react';
import { X, ArrowRightLeft } from 'lucide-react';
import { Card } from '../ui/EnterpriseUI';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { LoadingSpinner } from '../ui/EnterpriseUI';
import { getRackView, movePallet } from './rackService';
import type { RackCell } from './types';

interface Props {
    palletId: string;
    palletNumber: string;
    warehouseId: string;
    currentLocationCode: string;
    onClose: () => void;
    onMoved: () => void;
}

export function MovePalletDialog({ palletId, palletNumber, warehouseId, currentLocationCode, onClose, onMoved }: Props) {
    const [emptyCells, setEmptyCells] = useState<RackCell[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCell, setSelectedCell] = useState<RackCell | null>(null);
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        getRackView({ warehouse_id: warehouseId, status_filter: 'EMPTY' })
            .then(r => setEmptyCells(r.cells))
            .catch(e => setError(e?.message ?? 'Failed to load empty cells'))
            .finally(() => setLoading(false));
    }, [warehouseId]);

    const submit = async () => {
        if (!selectedCell) return setError('Select a destination cell');
        if (!reason.trim()) return setError('Reason is required');
        setSubmitting(true); setError(null);
        try {
            await movePallet({
                pallet_id:            palletId,
                dest_warehouse_id:    selectedCell.warehouse_id,
                dest_rack:            selectedCell.rack,
                dest_location_number: selectedCell.location_number,
                move_reason:          reason.trim(),
                idempotency_key:      crypto.randomUUID(),
            });
            onMoved();
        } catch (e: any) {
            setError(e?.message ?? 'Move failed');
        } finally {
            setSubmitting(false);
        }
    };

    const byRack = emptyCells.reduce<Record<string, RackCell[]>>((acc, c) => {
        (acc[c.rack] ??= []).push(c); return acc;
    }, {});

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Card style={{ width: '90%', maxWidth: '760px', maxHeight: '85vh', overflow: 'auto', padding: 0 }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
                            <ArrowRightLeft size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                            Move Pallet
                        </h2>
                        <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', margin: '2px 0 0' }}>
                            {palletNumber} · currently at <strong>{currentLocationCode}</strong>
                        </p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                <div style={{ padding: '16px 20px' }}>
                    <Label>Destination Cell (empty cells only)</Label>
                    {loading ? (
                        <div style={{ padding: 20, textAlign: 'center' }}><LoadingSpinner size={24} /></div>
                    ) : emptyCells.length === 0 ? (
                        <div style={{ padding: 20, textAlign: 'center', color: 'var(--enterprise-gray-500)' }}>
                            No empty cells in this warehouse. Scale the rack first.
                        </div>
                    ) : (
                        <div style={{ maxHeight: '320px', overflow: 'auto', marginTop: '6px' }}>
                            {Object.keys(byRack).sort().map(rack => (
                                <div key={rack} style={{ marginBottom: '10px' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--enterprise-gray-700)', margin: '8px 0 6px' }}>Rack {rack}</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: '4px' }}>
                                        {byRack[rack].sort((a, b) => a.location_number - b.location_number).map(c => (
                                            <button key={c.rack_location_id}
                                                onClick={() => setSelectedCell(c)}
                                                style={{
                                                    padding: '8px 6px',
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    border: selectedCell?.rack_location_id === c.rack_location_id
                                                        ? '2px solid var(--enterprise-primary)'
                                                        : '1px dashed #9ca3af',
                                                    borderRadius: '4px',
                                                    background: selectedCell?.rack_location_id === c.rack_location_id ? '#eff6ff' : 'white',
                                                    cursor: 'pointer',
                                                }}>
                                                {c.location_code}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ marginTop: '16px' }}>
                        <Label>Reason *</Label>
                        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rack A consolidation" />
                    </div>
                </div>

                {error && <div style={{ padding: '12px 20px', background: '#fef2f2', color: '#991b1b' }}>⚠ {error}</div>}

                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
                    <Button onClick={submit} disabled={submitting || !selectedCell || !reason.trim()}>
                        {submitting ? 'Moving…' : `Move to ${selectedCell?.location_code ?? '—'}`}
                    </Button>
                </div>
            </Card>
        </div>
    );
}
