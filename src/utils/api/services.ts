import { apiClient } from './client';
import type {
  DashboardData,
  ItemsResponse,
  InventoryResponse,
  BlanketOrdersResponse,
  BlanketReleasesResponse,
  ForecastResponse,
  PlanningResponse,
  SeedDatabaseResponse,
  Item,
  Inventory,
  BlanketOrder,
  BlanketRelease,
} from '../../types';

// ============================================================================
// DASHBOARD SERVICE
// ============================================================================

export const dashboardService = {
  async getDashboard(accessToken: string): Promise<DashboardData> {
    return apiClient.get<DashboardData>('/dashboard', accessToken);
  },
};

// ============================================================================
// ITEM MASTER SERVICE
// ============================================================================

export const itemService = {
  async getItems(accessToken: string): Promise<Item[]> {
    const response = await apiClient.get<ItemsResponse>('/items', accessToken);
    return response.items || [];
  },

  async createItem(item: Omit<Item, 'id' | 'createdAt' | 'createdBy'>, accessToken: string): Promise<Item> {
    const response = await apiClient.post<{ success: boolean; item: Item }>('/items', item, accessToken);
    return response.item;
  },

  async updateItem(id: string, item: Partial<Item>, accessToken: string): Promise<Item> {
    const response = await apiClient.put<{ success: boolean; item: Item }>(`/items/${id}`, item, accessToken);
    return response.item;
  },

  async deleteItem(id: string, accessToken: string): Promise<void> {
    await apiClient.delete(`/items/${id}`, accessToken);
  },
};

// ============================================================================
// INVENTORY SERVICE
// ============================================================================

export const inventoryService = {
  async getInventory(accessToken: string): Promise<Inventory[]> {
    const response = await apiClient.get<InventoryResponse>('/inventory', accessToken);
    return response.inventory || [];
  },

  async updateInventory(id: string, data: Partial<Inventory>, accessToken: string): Promise<Inventory> {
    const response = await apiClient.put<{ success: boolean; inventory: Inventory }>(`/inventory/${id}`, data, accessToken);
    return response.inventory;
  },
};

// ============================================================================
// BLANKET ORDER SERVICE
// ============================================================================

export const blanketOrderService = {
  async getOrders(accessToken: string): Promise<BlanketOrder[]> {
    const response = await apiClient.get<BlanketOrdersResponse>('/blanket-orders', accessToken);
    return response.orders || [];
  },

  async createOrder(order: Omit<BlanketOrder, 'id' | 'createdAt' | 'createdBy'>, accessToken: string): Promise<BlanketOrder> {
    const response = await apiClient.post<{ success: boolean; order: BlanketOrder }>('/blanket-orders', order, accessToken);
    return response.order;
  },

  async updateOrder(id: string, order: Partial<BlanketOrder>, accessToken: string): Promise<BlanketOrder> {
    const response = await apiClient.put<{ success: boolean; order: BlanketOrder }>(`/blanket-orders/${id}`, order, accessToken);
    return response.order;
  },

  async deleteOrder(id: string, accessToken: string): Promise<void> {
    await apiClient.delete(`/blanket-orders/${id}`, accessToken);
  },
};

// ============================================================================
// BLANKET RELEASE SERVICE
// ============================================================================

export const blanketReleaseService = {
  async getReleases(accessToken: string): Promise<BlanketRelease[]> {
    const response = await apiClient.get<BlanketReleasesResponse>('/blanket-releases', accessToken);
    return response.releases || [];
  },

  async createRelease(release: Omit<BlanketRelease, 'id' | 'createdAt' | 'createdBy'>, accessToken: string): Promise<BlanketRelease> {
    const response = await apiClient.post<{ success: boolean; release: BlanketRelease }>('/blanket-releases', release, accessToken);
    return response.release;
  },

  async fulfillRelease(id: string, accessToken: string): Promise<BlanketRelease> {
    const response = await apiClient.post<{ success: boolean; release: BlanketRelease }>(`/blanket-releases/${id}/fulfill`, {}, accessToken);
    return response.release;
  },
};

// ============================================================================
// FORECASTING SERVICE
// ============================================================================

export const forecastService = {
  async generateForecast(itemId: string, periods: number, accessToken: string): Promise<any> {
    return apiClient.post('/forecast/generate', { itemId, periods }, accessToken);
  },

  async getForecasts(accessToken: string): Promise<any[]> {
    const response = await apiClient.get<ForecastResponse>('/forecasts', accessToken);
    return response.forecasts || [];
  },
};

// ============================================================================
// PLANNING SERVICE
// ============================================================================

export const planningService = {
  async generatePlanning(accessToken: string): Promise<any> {
    return apiClient.post('/planning/generate', {}, accessToken);
  },

  async getPlans(accessToken: string): Promise<any[]> {
    const response = await apiClient.get<PlanningResponse>('/planning', accessToken);
    return response.plans || [];
  },
};

// ============================================================================
// SEED SERVICE
// ============================================================================

export const seedService = {
  async seedDatabase(accessToken: string): Promise<SeedDatabaseResponse> {
    return apiClient.post<SeedDatabaseResponse>('/seed-database', {}, accessToken);
  },
};
