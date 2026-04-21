/**
 * Packing Engine — Barrel Export
 *
 * All packing engine components exported from a single entry point.
 */

export { PalletDashboard } from './PalletDashboard';
export { ContractConfigManager } from './ContractConfigManager';
export { DispatchSelection } from './DispatchSelection';
export { PackingListManager } from './PackingListManager';
export { PackingListPrint } from './PackingListPrint';
export { TraceabilityViewer } from './TraceabilityViewer';
export { MasterPackingListHome } from './MasterPackingListHome';
export { PerformaInvoice } from './PerformaInvoice';

// Re-export types and service functions
export type {
    ContractConfig,
    PackContainer,
    Pallet,
    PalletState,
    PackingList,
    PackInvoice,
    ProformaInvoice,
    DispatchReadiness,
    TraceRecord,
    PackingSpec,
    PalletImpact,
    PackingListData,
    PackingListPalletDetail,
} from './packingEngineService';

// Re-export MPL types and service functions
export type {
    MasterPackingList,
    MplPallet,
    MplStatus,
    MplDashboardRow,
    InnerBoxDetail,
    DispatchAuditEntry,
} from './mplService';

// Re-export engine service functions.
// `processPackingBoxAsContainer` was removed — the sticker-generation
// migration moved that routing logic server-side into `sg_auto-generate`.
export {
    getPackingSpecForItem,
    fetchPackingSpecs,
    calculatePalletImpact,
} from './packingEngineService';

// Re-export MPL service functions
export {
    fetchMasterPackingLists,
    fetchMplById,
    fetchMplPallets,
    createMasterPackingList,
    confirmMpl,
    markMplPrinted,
    cancelMpl,
    createPerformaInvoice,
    approvePerformaInvoice,
    searchMasterPackingLists,
    fetchDispatchAuditLog,
    fetchCorrelatedAuditLog,
} from './mplService';
