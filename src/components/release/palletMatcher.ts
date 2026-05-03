/**
 * palletMatcher — finds whole-pallet combinations that satisfy a customer
 * release quantity exactly, or proposes the closest options above/below
 * when no exact subset exists.
 *
 * Strategy:
 *   1. FIFO-prefix shortcut. Walk pallets oldest-first; if a prefix sum
 *      equals the target, return immediately (cheapest, most-FIFO answer).
 *   2. Subset-sum DP up to the target plus the largest pallet qty. Recovers
 *      an exact match if one exists, plus the closest reachable sum above
 *      and below the target. Pallets are processed in FIFO order, so the
 *      DP naturally prefers older shipments.
 *   3. If target exceeds total available stock, returns null exact + null
 *      above and a "below = everything" hint so the caller can show the
 *      shortfall.
 *
 * Whole-pallet semantics: every chosen pallet is taken at its full
 * quantity. No partial picks. Matches the WMS rule that we ship pallets,
 * not loose pieces.
 */

export interface MatcherPallet {
    id:        string;
    qty:       number;
    /** Lower = older. Use shipment_sequence first, placed_at as tie-break. */
    fifoOrder: number;
}

export interface MatcherSelection {
    pallets:   MatcherPallet[];
    totalQty:  number;
}

export type ExactVia = 'FIFO_PREFIX' | 'SUBSET_SEARCH';

export interface MatcherResult {
    exact:           MatcherSelection | null;
    exactVia:        ExactVia | null;
    above:           MatcherSelection | null; // smallest reachable sum > target
    below:           MatcherSelection | null; // largest  reachable sum < target
    availableTotal:  number;
    /** True when the requested quantity exceeds total available stock. */
    insufficient:    boolean;
}

export function matchPallets(input: MatcherPallet[], target: number): MatcherResult {
    const pallets = [...input].sort((a, b) => a.fifoOrder - b.fifoOrder);
    const availableTotal = pallets.reduce((s, p) => s + p.qty, 0);

    if (target <= 0 || pallets.length === 0) {
        return { exact: null, exactVia: null, above: null, below: null, availableTotal, insufficient: target > availableTotal };
    }

    // ── 1. FIFO-prefix shortcut ──────────────────────────────────────────
    let cum = 0;
    let prefixBelow: MatcherPallet[] = [];
    for (const p of pallets) {
        if (cum + p.qty === target) {
            return {
                exact: { pallets: [...prefixBelow, p], totalQty: target },
                exactVia: 'FIFO_PREFIX',
                above: null, below: null,
                availableTotal,
                insufficient: false,
            };
        }
        if (cum + p.qty < target) {
            prefixBelow.push(p);
            cum += p.qty;
        } else {
            break;
        }
    }

    // ── Insufficient-stock case ──────────────────────────────────────────
    if (target > availableTotal) {
        return {
            exact: null, exactVia: null, above: null,
            below: { pallets: [...pallets], totalQty: availableTotal },
            availableTotal,
            insufficient: true,
        };
    }

    // ── 2. Subset-sum DP ─────────────────────────────────────────────────
    // Cap upper search at min(total, target + maxPalletQty) so we can find
    // the smallest reachable sum strictly above the target.
    const maxQty = Math.max(...pallets.map(p => p.qty));
    const cap    = Math.min(availableTotal, target + maxQty);

    // parent[s] = index of pallet that made s reachable; -1 = base; -2 = unreachable.
    const parent = new Int32Array(cap + 1).fill(-2);
    parent[0] = -1;

    for (let i = 0; i < pallets.length; i++) {
        const q = pallets[i].qty;
        if (q > cap) continue;
        // Iterate high → low so each pallet is used at most once (0/1 knapsack pattern).
        for (let s = cap; s >= q; s--) {
            if (parent[s] === -2 && parent[s - q] !== -2) {
                parent[s] = i;
            }
        }
    }

    function trace(sum: number): MatcherPallet[] | null {
        if (parent[sum] === -2) return null;
        const out: MatcherPallet[] = [];
        let cur = sum;
        while (cur > 0) {
            const i = parent[cur];
            if (i < 0) return null;
            out.push(pallets[i]);
            cur -= pallets[i].qty;
        }
        return out.reverse();
    }

    // Exact
    let exact: MatcherSelection | null = null;
    const exactRecover = trace(target);
    if (exactRecover) {
        exact = { pallets: exactRecover, totalQty: target };
    }

    // Closest above target (skip exact)
    let above: MatcherSelection | null = null;
    for (let s = target + 1; s <= cap; s++) {
        if (parent[s] !== -2) {
            const r = trace(s);
            if (r) { above = { pallets: r, totalQty: s }; break; }
        }
    }

    // Closest below target
    let below: MatcherSelection | null = null;
    for (let s = target - 1; s >= 0; s--) {
        if (parent[s] !== -2) {
            const r = trace(s);
            if (r) { below = { pallets: r, totalQty: s }; break; }
        }
    }

    return {
        exact,
        exactVia: exact ? 'SUBSET_SEARCH' : null,
        above,
        below,
        availableTotal,
        insufficient: false,
    };
}
