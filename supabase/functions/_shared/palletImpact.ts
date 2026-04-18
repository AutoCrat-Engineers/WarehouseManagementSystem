/**
 * _shared/palletImpact.ts
 *
 * Shared pallet impact algorithm — used by both:
 *   - calculate-pallet-impact/index.ts  (UI preview endpoint)
 *   - submit-movement-request/index.ts  (server-side qty derivation for PRODUCTION_RECEIPT)
 *
 * Logic is IDENTICAL to calculatePalletImpact() in packingEngineService.ts.
 * No business logic changes — purely relocated server-side.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface PalletImpact {
  currentPallet: {
    pallet_number: string;
    pallet_id: string;
    current_qty: number;
    target_qty: number;
    containers_filled: number;
    total_containers_needed: number;
    containers_needed: number;
    adjustment_qty: number;
    adjustment_needed: boolean;
    state: string;
  } | null;
  inner_box_qty: number;
  outer_box_qty: number;
  full_containers_per_pallet: number;
  total_containers_per_pallet: number;
  adjustment_qty_per_pallet: number;
  adjustmentBoxIncluded: boolean;
  adjustedInnerBoxCount: number;
  adjustedTotalQty: number;
  breakdownText: string;
  boxesToCurrentPallet: number;
  boxesToNewPallet: number;
  willCompletePallet: boolean;
  adjustmentBoxRequired: boolean;
  adjustmentBoxQty: number;
  mustCreateAdjustmentFirst: boolean;
  adjustmentBoxesForExistingPallets: number;
  totalAdjustmentBoxes: number;
  palletSummary: string;
  warnings: string[];
}

export async function calculatePalletImpactInternal(
  db: ReturnType<typeof createClient>,
  item_code: string,
  incoming_box_count: number,
): Promise<PalletImpact> {
  // Fetch packing spec
  const { data: specData, error: specErr } = await db
    .from('packing_specifications')
    .select('inner_box_quantity, outer_box_quantity')
    .eq('item_code', item_code)
    .eq('is_active', true)
    .single();

  if (specErr || !specData) throw new Error(`No packing specification found for item ${item_code}`);

  const innerQty: number = specData.inner_box_quantity;
  const outerQty: number = specData.outer_box_quantity;
  if (innerQty <= 0 || outerQty <= 0) throw new Error('Invalid packing spec');

  const fullContainersPerPallet = Math.floor(outerQty / innerQty);
  const adjustmentQtyPerPallet = outerQty % innerQty;
  // Total containers per pallet = full inner boxes + adjustment box (if applicable)
  // e.g., OPW-03: 66 full + 1 adj = 67; items with no adj remainder: just 66
  const totalContainersPerPallet = fullContainersPerPallet + (adjustmentQtyPerPallet > 0 ? 1 : 0);

  // ──────────────────────────────────────────────────────────────────────
  // MULTI-PALLET AWARENESS: Fetch ALL open/filling/adjustment pallets
  // Previously: .limit(1) — only detected the FIRST pallet needing adjustment
  // Now: .limit(50) — detects ALL pallets needing adjustment
  // ──────────────────────────────────────────────────────────────────────
  const { data: allOpenPallets } = await db
    .from('pack_pallets')
    .select('*')
    .eq('item_code', item_code)
    .in('state', ['OPEN', 'FILLING', 'ADJUSTMENT_REQUIRED'])
    .order('created_at', { ascending: true })
    .limit(50);

  // Separate pallets by state: ADJUSTMENT_REQUIRED vs OPEN/FILLING
  const adjRequiredPallets = (allOpenPallets || []).filter((p: any) => p.state === 'ADJUSTMENT_REQUIRED');
  const fillingPallets = (allOpenPallets || []).filter((p: any) => p.state !== 'ADJUSTMENT_REQUIRED');
  const adjustmentPalletsCount = adjRequiredPallets.length;

  // The "current" pallet is the one being filled (OPEN/FILLING) — not the adj ones
  const currentPallet = fillingPallets.length > 0 ? fillingPallets[0] : null;
  const currentQty = currentPallet?.current_qty || 0;
  const targetQty = currentPallet?.target_qty || outerQty;
  const containersFilled = currentPallet?.container_count || 0;
  const adjContainerCount = currentPallet?.adjustment_container_count || 0;

  const fullBoxesRemainingForPallet = Math.max(0, fullContainersPerPallet - containersFilled);
  const currentPalletNeedsAdj = adjustmentQtyPerPallet > 0 && adjContainerCount === 0;

  // ──────────────────────────────────────────────────────────────────────
  // STEP 1: Allocate boxes to EXISTING pallets needing adjustment FIRST
  //   Priority: Fill existing ADJUSTMENT_REQUIRED pallets before anything else
  // ──────────────────────────────────────────────────────────────────────
  const adjustmentBoxesForExisting = Math.min(incoming_box_count, adjustmentPalletsCount);
  let remainingBoxes = incoming_box_count - adjustmentBoxesForExisting;

  // ──────────────────────────────────────────────────────────────────────
  // STEP 2: Allocate remaining boxes to current FILLING pallet
  // ──────────────────────────────────────────────────────────────────────
  let innerBoxesToCurrentPallet = Math.min(remainingBoxes, fullBoxesRemainingForPallet);
  let innerBoxesToNewPallet = remainingBoxes - innerBoxesToCurrentPallet;

  const afterThisMove_fullContainers = containersFilled + innerBoxesToCurrentPallet;
  const willFillAllFullContainers = afterThisMove_fullContainers >= fullContainersPerPallet;

  // AUTO-ADJUSTMENT for the CURRENT filling pallet boundary
  // When current pallet's full containers are filled, convert 1 box to adjustment
  let adjustmentBoxForCurrentPallet = false;
  let adjustedInnerBoxCount = remainingBoxes;
  let adjustedTotalQty = (adjustmentBoxesForExisting * adjustmentQtyPerPallet) + (remainingBoxes * innerQty);

  if (willFillAllFullContainers && currentPalletNeedsAdj && remainingBoxes > 0) {
    adjustmentBoxForCurrentPallet = true;
    adjustedInnerBoxCount = remainingBoxes - 1;
    adjustedTotalQty = (adjustmentBoxesForExisting * adjustmentQtyPerPallet) +
      (adjustedInnerBoxCount * innerQty) + adjustmentQtyPerPallet;
    // Recalculate split with adjusted count
    innerBoxesToCurrentPallet = Math.min(adjustedInnerBoxCount, fullBoxesRemainingForPallet);
    innerBoxesToNewPallet = adjustedInnerBoxCount - innerBoxesToCurrentPallet;
  }

  const totalAdjustmentBoxes = adjustmentBoxesForExisting + (adjustmentBoxForCurrentPallet ? 1 : 0);
  const totalNormalBoxes = incoming_box_count - totalAdjustmentBoxes;
  const adjustmentBoxIncluded = totalAdjustmentBoxes > 0;

  const willCompletePallet = currentPallet
    ? (willFillAllFullContainers && (adjustmentBoxForCurrentPallet || !currentPalletNeedsAdj))
    : false;
  // mustCreateAdjustmentFirst: true if ANY adjustment boxes are needed
  // (either for existing ADJUSTMENT_REQUIRED pallets OR for the current pallet boundary)
  const mustCreateAdjustmentFirst = totalAdjustmentBoxes > 0;

  // ──────────────────────────────────────────────────────────────────────
  // BREAKDOWN TEXT — Clear description of what will happen
  // ──────────────────────────────────────────────────────────────────────
  const parts: string[] = [];

  if (adjustmentBoxesForExisting > 0) {
    parts.push(
      `${adjustmentBoxesForExisting} Top-Up Box${adjustmentBoxesForExisting > 1 ? 'es' : ''} x ${adjustmentQtyPerPallet.toLocaleString()} PCS (completing ${adjustmentBoxesForExisting} existing pallet${adjustmentBoxesForExisting > 1 ? 's' : ''})`,
    );
  }
  if (totalNormalBoxes > 0) {
    parts.push(`${totalNormalBoxes} Box${totalNormalBoxes > 1 ? 'es' : ''} x ${innerQty.toLocaleString()} PCS`);
  }
  if (adjustmentBoxForCurrentPallet) {
    parts.push(`1 Top-off Box x ${adjustmentQtyPerPallet.toLocaleString()} PCS (completing current pallet)`);
  }

  if (!adjustmentBoxIncluded) {
    adjustedTotalQty = incoming_box_count * innerQty;
  }
  const breakdownText = parts.join(' + ') + ` = ${adjustedTotalQty.toLocaleString()} PCS`;

  // ──────────────────────────────────────────────────────────────────────
  // WARNINGS — Clear user-facing warnings
  // ──────────────────────────────────────────────────────────────────────
  const warnings: string[] = [];

  if (adjustmentBoxesForExisting > 0) {
    const palletNames = adjRequiredPallets
      .slice(0, adjustmentBoxesForExisting)
      .map((p: any) => p.pallet_number)
      .join(', ');
    warnings.push(
      `MULTI-PALLET ADJUSTMENT: ${adjustmentBoxesForExisting} of ${incoming_box_count} Boxes will be converted to ` +
      `Top-Up Boxes (${adjustmentQtyPerPallet} PCS each) to complete pallet(s): ${palletNames}.`,
    );
  }

  if (adjustmentBoxForCurrentPallet) {
    warnings.push(
      `PALLET BOUNDARY: 1 additional Box will be converted to a Top-off Box (${adjustmentQtyPerPallet} PCS) ` +
      `to complete ${currentPallet?.pallet_number || 'the current pallet'}.`,
    );
  }

  if (innerBoxesToNewPallet > 0) {
    warnings.push(`${innerBoxesToNewPallet} Box(es) will overflow to a new pallet.`);
  }

  // ──────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────────────
  const palletNumber = currentPallet?.pallet_number || 'NEW';
  let palletSummary = '';

  if (adjustmentPalletsCount > 0) {
    palletSummary = `${adjustmentPalletsCount} pallet(s) awaiting adjustment. `;
  }

  if (!currentPallet && adjustmentPalletsCount === 0) {
    palletSummary += `No active pallet. New pallet (${totalContainersPerPallet} containers) will be created.`;
  } else if (currentPallet) {
    palletSummary += `Pallet ${palletNumber}: ${currentQty.toLocaleString()}/${targetQty.toLocaleString()} PCS (${containersFilled}/${totalContainersPerPallet} containers).`;
  }

  if (totalAdjustmentBoxes > 0) {
    palletSummary += ` Adjustment: ${totalAdjustmentBoxes} Top-Up Box(es).`;
  }
  if (innerBoxesToNewPallet > 0) {
    palletSummary += ` ${innerBoxesToNewPallet} Box(es) will overflow to new pallet.`;
  }

  return {
    currentPallet: currentPallet
      ? {
        pallet_number: currentPallet.pallet_number,
        pallet_id: currentPallet.id,
        current_qty: currentQty,
        target_qty: targetQty,
        containers_filled: containersFilled,
        total_containers_needed: totalContainersPerPallet,
        containers_needed: Math.max(0, fullBoxesRemainingForPallet),
        adjustment_qty: adjustmentQtyPerPallet,
        adjustment_needed: currentPalletNeedsAdj,
        state: currentPallet.state,
      }
      : null,
    inner_box_qty: innerQty,
    outer_box_qty: outerQty,
    full_containers_per_pallet: fullContainersPerPallet,
    total_containers_per_pallet: totalContainersPerPallet,
    adjustment_qty_per_pallet: adjustmentQtyPerPallet,
    adjustmentBoxIncluded,
    adjustedInnerBoxCount: totalNormalBoxes,
    adjustedTotalQty,
    breakdownText,
    boxesToCurrentPallet: innerBoxesToCurrentPallet,
    adjustmentBoxesForExistingPallets: adjustmentBoxesForExisting,
    totalAdjustmentBoxes,
    boxesToNewPallet: innerBoxesToNewPallet,
    willCompletePallet,
    adjustmentBoxRequired: adjustmentBoxIncluded,
    adjustmentBoxQty: adjustmentQtyPerPallet,
    mustCreateAdjustmentFirst,
    palletSummary,
    warnings,
  };
}
