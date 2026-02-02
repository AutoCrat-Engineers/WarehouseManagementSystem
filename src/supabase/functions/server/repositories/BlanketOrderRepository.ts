// /**
//  * Blanket Order Repository - Data Access Layer
//  * Handles all database operations for Blanket Orders and Releases
//  */

// import * as kv from '../kv_store.tsx';

// export interface BlanketOrder {
//   id: string;
//   orderNumber: string;
//   customerName: string;
//   customerCode?: string;
//   orderDate: string;
//   startDate: string;
//   endDate: string;
//   status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
//   createdAt: string;
//   createdBy: string;
//   updatedAt?: string;
//   updatedBy?: string;
// }

// export interface BlanketOrderLine {
//   id: string;
//   orderId: string;
//   itemId: string;
//   totalQuantity: number;
//   releasedQuantity: number;
//   deliveredQuantity: number;
//   unitPrice?: number;
//   createdAt: string;
//   createdBy: string;
// }

// export interface BlanketRelease {
//   id: string;
//   releaseNumber: string;
//   orderId: string;
//   lineId: string;
//   itemId: string;
//   releaseDate: string;
//   requestedDeliveryDate: string;
//   actualDeliveryDate?: string;
//   requestedQuantity: number;
//   deliveredQuantity: number;
//   status: 'PENDING' | 'CONFIRMED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
//   shipmentNumber?: string;
//   trackingNumber?: string;
//   notes?: string;
//   createdAt: string;
//   createdBy: string;
//   updatedAt?: string;
//   updatedBy?: string;
// }

// export class BlanketOrderRepository {
//   private orderPrefix = 'blanket-order:';
//   private linePrefix = 'blanket-order-line:';
//   private releasePrefix = 'blanket-release:';

//   // ========== BLANKET ORDERS ==========

//   async getOrderById(id: string): Promise<BlanketOrder | null> {
//     const order = await kv.get(id);
//     return order as BlanketOrder | null;
//   }

//   async getAllOrders(): Promise<BlanketOrder[]> {
//     const orders = await kv.getByPrefix(this.orderPrefix);
//     return orders as BlanketOrder[];
//   }

//   async getActiveOrders(): Promise<BlanketOrder[]> {
//     const orders = await this.getAllOrders();
//     return orders.filter(o => o.status === 'ACTIVE');
//   }

//   async createOrder(data: Omit<BlanketOrder, 'id'>): Promise<BlanketOrder> {
//     const id = `${this.orderPrefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
//     const order: BlanketOrder = {
//       id,
//       ...data
//     };

//     await kv.set(id, order);
//     return order;
//   }

//   async updateOrder(id: string, data: Partial<BlanketOrder>): Promise<BlanketOrder | null> {
//     const existing = await this.getOrderById(id);
//     if (!existing) return null;

//     const updated: BlanketOrder = {
//       ...existing,
//       ...data,
//       id: existing.id
//     };

//     await kv.set(id, updated);
//     return updated;
//   }

//   // ========== BLANKET ORDER LINES ==========

//   async getLineById(id: string): Promise<BlanketOrderLine | null> {
//     const line = await kv.get(id);
//     return line as BlanketOrderLine | null;
//   }

//   async getLinesByOrderId(orderId: string): Promise<BlanketOrderLine[]> {
//     const allLines = await kv.getByPrefix(this.linePrefix);
//     return allLines.filter((l: any) => l.orderId === orderId) as BlanketOrderLine[];
//   }

//   async getLinesByItemId(itemId: string): Promise<BlanketOrderLine[]> {
//     const allLines = await kv.getByPrefix(this.linePrefix);
//     return allLines.filter((l: any) => l.itemId === itemId) as BlanketOrderLine[];
//   }

//   async createLine(data: Omit<BlanketOrderLine, 'id'>): Promise<BlanketOrderLine> {
//     const id = `${this.linePrefix}${data.orderId}:${data.itemId}:${Date.now()}`;
    
//     const line: BlanketOrderLine = {
//       id,
//       releasedQuantity: 0,
//       deliveredQuantity: 0,
//       ...data
//     };

//     await kv.set(id, line);
//     return line;
//   }

//   async updateLine(id: string, data: Partial<BlanketOrderLine>): Promise<BlanketOrderLine | null> {
//     const existing = await this.getLineById(id);
//     if (!existing) return null;

//     const updated: BlanketOrderLine = {
//       ...existing,
//       ...data,
//       id: existing.id
//     };

//     await kv.set(id, updated);
//     return updated;
//   }

//   // ========== BLANKET RELEASES ==========

//   async getReleaseById(id: string): Promise<BlanketRelease | null> {
//     const release = await kv.get(id);
//     return release as BlanketRelease | null;
//   }

//   async getAllReleases(): Promise<BlanketRelease[]> {
//     const releases = await kv.getByPrefix(this.releasePrefix);
//     return releases as BlanketRelease[];
//   }

//   async getReleasesByOrderId(orderId: string): Promise<BlanketRelease[]> {
//     const allReleases = await this.getAllReleases();
//     return allReleases.filter(r => r.orderId === orderId);
//   }

//   async getReleasesByItemId(itemId: string): Promise<BlanketRelease[]> {
//     const allReleases = await this.getAllReleases();
//     return allReleases.filter(r => r.itemId === itemId);
//   }

//   async createRelease(data: Omit<BlanketRelease, 'id'>): Promise<BlanketRelease> {
//     const id = `${this.releasePrefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
//     const release: BlanketRelease = {
//       id,
//       deliveredQuantity: 0,
//       ...data
//     };

//     await kv.set(id, release);
//     return release;
//   }

//   async updateRelease(id: string, data: Partial<BlanketRelease>): Promise<BlanketRelease | null> {
//     const existing = await this.getReleaseById(id);
//     if (!existing) return null;

//     const updated: BlanketRelease = {
//       ...existing,
//       ...data,
//       id: existing.id
//     };

//     await kv.set(id, updated);
//     return updated;
//   }

//   /**
//    * Get total reserved quantity for an item (from active orders)
//    */
//   async getReservedQuantityByItem(itemId: string): Promise<number> {
//     const lines = await this.getLinesByItemId(itemId);
//     const activeOrders = await this.getActiveOrders();
//     const activeOrderIds = new Set(activeOrders.map(o => o.id));

//     return lines
//       .filter(line => activeOrderIds.has(line.orderId))
//       .reduce((sum, line) => sum + (line.totalQuantity - line.deliveredQuantity), 0);
//   }
// }


// repositories/BlanketOrderRepository.ts
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export class BlanketOrderRepository {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
  }

  async getAllOrders() {
    const { data, error } = await this.supabase
      .from('blanket_orders')
      .select(`
        *,
        blanket_order_lines (*)
      `)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data;
  }

  async getOrderWithLines(orderId: string) {
    const { data, error } = await this.supabase
      .from('blanket_orders')
      .select(`
        *,
        blanket_order_lines (*)
      `)
      .eq('id', orderId)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async createOrder(order: any, userId: string) {
    const { data: orderHeader, error: orderError } = await this.supabase
      .from('blanket_orders')
      .insert({
        ...order,
        created_by: userId
      })
      .select()
      .single();

    if (orderError) throw new Error(orderError.message);
    return orderHeader;
  }

  async createOrderLines(lines: any[]) {
    const { data, error } = await this.supabase
      .from('blanket_order_lines')
      .insert(lines)
      .select();

    if (error) throw new Error(error.message);
    return data;
  }
}
