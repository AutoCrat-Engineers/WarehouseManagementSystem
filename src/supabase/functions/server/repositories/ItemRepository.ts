// /**
//  * Item Repository - Data Access Layer
//  * Handles all database operations for Item Master
//  */

// import * as kv from '../kv_store.tsx';

// export interface Item {
//   id: string;
//   itemCode: string;
//   itemName: string;
//   description?: string;
//   uom: string;
//   minStock: number;
//   maxStock: number;
//   safetyStock: number;
//   leadTimeDays: number;
//   status: 'active' | 'inactive';
//   createdAt: string;
//   createdBy: string;
//   updatedAt?: string;
//   updatedBy?: string;
// }

// export class ItemRepository {
//   private prefix = 'item:';

//   /**
//    * Get item by ID
//    */
//   async getById(id: string): Promise<Item | null> {
//     const item = await kv.get(id);
//     return item as Item | null;
//   }

//   /**
//    * Get item by item code
//    */
//   async getByCode(itemCode: string): Promise<Item | null> {
//     const allItems = await kv.getByPrefix(this.prefix);
//     const item = allItems.find((i: any) => i.itemCode === itemCode);
//     return item as Item | null;
//   }

//   /**
//    * Get all items
//    */
//   async getAll(): Promise<Item[]> {
//     const items = await kv.getByPrefix(this.prefix);
//     return items as Item[];
//   }

//   /**
//    * Get active items only
//    */
//   async getActive(): Promise<Item[]> {
//     const items = await this.getAll();
//     return items.filter(item => item.status === 'active');
//   }

//   /**
//    * Create new item
//    */
//   async create(data: Omit<Item, 'id'>): Promise<Item> {
//     const id = `${this.prefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
//     const item: Item = {
//       id,
//       ...data
//     };

//     await kv.set(id, item);
//     return item;
//   }

//   /**
//    * Update item
//    */
//   async update(id: string, data: Partial<Item>): Promise<Item | null> {
//     const existing = await this.getById(id);
//     if (!existing) {
//       return null;
//     }

//     const updated: Item = {
//       ...existing,
//       ...data,
//       id: existing.id // Preserve ID
//     };

//     await kv.set(id, updated);
//     return updated;
//   }

//   /**
//    * Delete item (soft delete by setting status to inactive)
//    */
//   async delete(id: string): Promise<boolean> {
//     const existing = await this.getById(id);
//     if (!existing) {
//       return false;
//     }

//     // Soft delete
//     await this.update(id, { status: 'inactive' });
//     return true;
//   }

//   /**
//    * Hard delete (remove from database)
//    */
//   async hardDelete(id: string): Promise<boolean> {
//     await kv.del(id);
//     return true;
//   }

//   /**
//    * Check if item code exists
//    */
//   async codeExists(itemCode: string, excludeId?: string): Promise<boolean> {
//     const existing = await this.getByCode(itemCode);
//     if (!existing) return false;
//     if (excludeId && existing.id === excludeId) return false;
//     return true;
//   }
// }

// repositories/ItemRepository.ts
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export class ItemRepository {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
  }

  async getAllItems() {
    const { data, error } = await this.supabase
      .from('items')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data;
  }

  async getItemById(id: string) {
    const { data, error } = await this.supabase
      .from('items')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async createItem(payload: any, userId: string) {
    const { data, error } = await this.supabase
      .from('items')
      .insert({
        ...payload,
        created_by: userId
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateItem(id: string, payload: any, userId: string) {
    const { data, error } = await this.supabase
      .from('items')
      .update({
        ...payload,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteItem(id: string) {
    const { error } = await this.supabase
      .from('items')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
