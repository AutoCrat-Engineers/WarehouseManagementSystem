/**
 * Inventory Components Barrel Export
 * Export all inventory-related components for easy importing
 */

// Stock Distribution Card - For displaying stock breakdown per item
export { StockDistributionCard } from './StockDistributionCard';

// Inventory Grid - Main table view with all items
export { InventoryGrid } from './InventoryGrid';

// Re-export types for convenience
export type {
    ItemStockDashboard,
    ItemStockDistribution,
    ItemWarehouseDetail,
    ItemStockSummary,
    StockStatus,
    WarehouseCategory,
} from '../types/inventory';
