// ============================================================================
// DOMAIN TYPES
// ============================================================================

export interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  uom: string;
  minStock: number;
  maxStock: number;
  safetyStock: number;
  leadTimeDays: number;
  status: 'active' | 'inactive';
  createdAt: string;
  createdBy: string;
}

export interface Inventory {
  id: string;
  itemId: string;
  openingStock: number;
  currentStock: number;
  productionInward: number;
  customerOutward: number;
  lastUpdated: string;
  updatedBy: string;
}

export interface InventoryMovement {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  movementType: 'IN' | 'OUT';
  quantity: number;
  reason: string;
  referenceType: string;
  referenceId: string;
  balanceAfter: number;
  previousBalance: number;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

export interface BlanketOrder {
  id: string;
  orderNumber: string;
  customer: string;
  itemId: string;
  totalQuantity: number;
  validFrom: string;
  validTo: string;
  status: 'active' | 'inactive' | 'completed';
  createdAt: string;
  createdBy: string;
}

export interface BlanketRelease {
  id: string;
  blanketOrderId: string;
  releaseNumber: string;
  releaseDate: string;
  quantity: number;
  deliveryDate: string;
  status: 'pending' | 'fulfilled' | 'cancelled';
  createdAt: string;
  createdBy: string;
}

export interface Forecast {
  id: string;
  itemId: string;
  forecastDate: string;
  predictedDemand: number;
  confidence: number;
  generatedAt: string;
  generatedBy: string;
}

export interface Planning {
  id: string;
  itemId: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  forecastedDemand: number;
  recommendedProduction: number;
  status: 'healthy' | 'warning' | 'critical' | 'overstock';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  generatedAt: string;
  generatedBy: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface DashboardData {
  activeItems: number;
  totalInventoryValue: number;
  statusCounts: {
    healthy: number;
    warning: number;
    critical: number;
    overstock: number;
  };
  lastUpdated: string;
}

export interface ItemsResponse {
  items: Item[];
}

export interface InventoryResponse {
  inventory: Inventory[];
}

export interface BlanketOrdersResponse {
  orders: BlanketOrder[];
}

export interface BlanketReleasesResponse {
  releases: BlanketRelease[];
}

export interface ForecastResponse {
  forecasts: Forecast[];
}

export interface PlanningResponse {
  plans: Planning[];
}

export interface SeedDatabaseResponse {
  success: boolean;
  message: string;
  stats: {
    items: number;
    inventory: number;
    blanketOrders: number;
    releases: number;
  };
}

// ============================================================================
// AUTH TYPES
// ============================================================================

export interface User {
  id: string;
  email: string;
  user_metadata?: {
    name?: string;
    role?: string;
  };
}

export interface AuthSession {
  access_token: string;
  user: User;
}