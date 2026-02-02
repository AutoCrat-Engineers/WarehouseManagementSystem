// /**
//  * Inventory Repository - Data Access Layer
//  * Handles all database operations for Inventory
//  */

// import * as kv from '../kv_store.tsx';

// export interface Inventory {
//   id: string;
//   itemId: string;
//   availableStock: number;
//   reservedStock: number;
//   inTransitStock: number;
//   lastMovementDate?: string;
//   lastMovementType?: string;
//   updatedAt: string;
//   updatedBy: string;
// }

// export interface StockMovement {
//   id: string;
//   itemId: string;
//   movementType: 'IN' | 'OUT' | 'ADJUSTMENT';
//   transactionType: string; // PRODUCTION, SHIPMENT, ADJUSTMENT, BLANKET_RELEASE, etc.
//   quantity: number;
//   balanceAfter: number;
//   referenceType?: string;
//   referenceId?: string;
//   referenceNumber?: string;
//   reason: string;
//   notes?: string;
//   createdAt: string;
//   createdBy: string;
// }

// export class InventoryRepository {
//   private inventoryPrefix = 'inventory:';
//   private movementPrefix = 'stock-movement:';

//   /**
//    * Get inventory by item ID
//    */
//   async getByItemId(itemId: string): Promise<Inventory | null> {
//     const id = `${this.inventoryPrefix}${itemId}`;
//     const inventory = await kv.get(id);
//     return inventory as Inventory | null;
//   }

//   /**
//    * Get all inventory records
//    */
//   async getAll(): Promise<Inventory[]> {
//     const inventory = await kv.getByPrefix(this.inventoryPrefix);
//     return inventory as Inventory[];
//   }

//   /**
//    * Create inventory record (called when item is created)
//    */
//   async create(itemId: string, userId: string): Promise<Inventory> {
//     const id = `${this.inventoryPrefix}${itemId}`;
    
//     const inventory: Inventory = {
//       id,
//       itemId,
//       availableStock: 0,
//       reservedStock: 0,
//       inTransitStock: 0,
//       updatedAt: new Date().toISOString(),
//       updatedBy: userId
//     };

//     await kv.set(id, inventory);
//     return inventory;
//   }

//   /**
//    * Update inventory stock levels
//    */
//   async updateStock(
//     itemId: string,
//     available?: number,
//     reserved?: number,
//     inTransit?: number,
//     userId?: string
//   ): Promise<Inventory | null> {
//     const id = `${this.inventoryPrefix}${itemId}`;
//     const existing = await kv.get(id);
    
//     if (!existing) {
//       return null;
//     }

//     const updated: Inventory = {
//       ...existing as Inventory,
//       ...(available !== undefined && { availableStock: available }),
//       ...(reserved !== undefined && { reservedStock: reserved }),
//       ...(inTransit !== undefined && { inTransitStock: inTransit }),
//       updatedAt: new Date().toISOString(),
//       ...(userId && { updatedBy: userId })
//     };

//     await kv.set(id, updated);
//     return updated;
//   }

//   /**
//    * Create stock movement record
//    */
//   async createMovement(movement: Omit<StockMovement, 'id' | 'createdAt'>): Promise<StockMovement> {
//     const id = `${this.movementPrefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
//     const record: StockMovement = {
//       id,
//       ...movement,
//       createdAt: new Date().toISOString()
//     };

//     await kv.set(id, record);
//     return record;
//   }

//   /**
//    * Get stock movements for an item
//    */
//   async getMovements(itemId: string, limit?: number): Promise<StockMovement[]> {
//     const allMovements = await kv.getByPrefix(this.movementPrefix);
//     const itemMovements = allMovements
//       .filter((m: any) => m.itemId === itemId)
//       .sort((a: any, b: any) => 
//         new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
//       );
    
//     if (limit) {
//       return itemMovements.slice(0, limit) as StockMovement[];
//     }
    
//     return itemMovements as StockMovement[];
//   }

//   /**
//    * Get all stock movements
//    */
//   async getAllMovements(limit?: number): Promise<StockMovement[]> {
//     const movements = await kv.getByPrefix(this.movementPrefix);
//     const sorted = movements.sort((a: any, b: any) => 
//       new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
//     );
    
//     if (limit) {
//       return sorted.slice(0, limit) as StockMovement[];
//     }
    
//     return sorted as StockMovement[];
//   }

//   /**
//    * Get total stock value (quantity only, can be extended with pricing)
//    */
//   async getTotalStockValue(): Promise<number> {
//     const allInventory = await this.getAll();
//     return allInventory.reduce((sum, inv) => sum + inv.availableStock, 0);
//   }
// }

// repositories/InventoryRepository.ts
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export class InventoryRepository {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
  }

  async getAllInventory() {
    const { data, error } = await this.supabase
      .from('inventory')
      .select(`
        *,
        items (
          item_name,
          category,
          safety_stock,
          min_stock_level,
          max_stock_level,
          uom
        )
      `)
      .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data;
  }

  async getInventoryByItemCode(itemCode: string) {
    const { data, error } = await this.supabase
      .from('inventory')
      .select('*')
      .eq('item_code', itemCode)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async getStockMovements(limit = 100) {
    const { data, error } = await this.supabase
      .from('stock_movements')
      .select('*')
      .order('movement_date', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return data;
  }

  async insertStockMovement(payload: any, userId: string) {
    const { data, error } = await this.supabase
      .from('stock_movements')
      .insert({
        ...payload,
        created_by: userId
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}
