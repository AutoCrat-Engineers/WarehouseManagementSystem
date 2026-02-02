// /**
//  * Item Service - Business Logic Layer
//  * Handles all business operations for Item Master
//  */

// import { ItemRepository, Item } from '../repositories/ItemRepository.ts';
// import { InventoryRepository } from '../repositories/InventoryRepository.ts';

// export class ItemService {
//   constructor(
//     private itemRepo: ItemRepository,
//     private inventoryRepo: InventoryRepository
//   ) {}

//   /**
//    * Get all items
//    */
//   async getAllItems(): Promise<Item[]> {
//     return await this.itemRepo.getAll();
//   }

//   /**
//    * Get active items
//    */
//   async getActiveItems(): Promise<Item[]> {
//     return await this.itemRepo.getActive();
//   }

//   /**
//    * Get item by ID
//    */
//   async getItemById(id: string): Promise<Item | null> {
//     return await this.itemRepo.getById(id);
//   }

//   /**
//    * Create new item
//    * Business Rules:
//    * - Item code must be unique
//    * - Max stock must be >= Min stock
//    * - Safety stock must be >= 0
//    * - Auto-creates inventory record with 0 stock
//    */
//   async createItem(
//     data: {
//       itemCode: string;
//       itemName: string;
//       description?: string;
//       uom: string;
//       minStock: number;
//       maxStock: number;
//       safetyStock: number;
//       leadTimeDays: number;
//       status?: 'active' | 'inactive';
//     },
//     userId: string
//   ): Promise<{ item: Item; inventory: any }> {
//     // Validation: Check if item code already exists
//     const codeExists = await this.itemRepo.codeExists(data.itemCode);
//     if (codeExists) {
//       throw new Error(`Item code '${data.itemCode}' already exists`);
//     }

//     // Validation: Max stock >= Min stock
//     if (data.maxStock < data.minStock) {
//       throw new Error('Maximum stock must be greater than or equal to minimum stock');
//     }

//     // Validation: Safety stock >= 0
//     if (data.safetyStock < 0) {
//       throw new Error('Safety stock cannot be negative');
//     }

//     // Validation: Lead time >= 0
//     if (data.leadTimeDays < 0) {
//       throw new Error('Lead time cannot be negative');
//     }

//     // Create item
//     const item = await this.itemRepo.create({
//       ...data,
//       status: data.status || 'active',
//       createdAt: new Date().toISOString(),
//       createdBy: userId
//     });

//     // Auto-create inventory record with 0 stock
//     const inventory = await this.inventoryRepo.create(item.id, userId);

//     return { item, inventory };
//   }

//   /**
//    * Update item
//    * Business Rules:
//    * - Item code must remain unique (if changed)
//    * - Max stock must be >= Min stock
//    * - Cannot deactivate if inventory exists
//    */
//   async updateItem(
//     id: string,
//     data: Partial<Omit<Item, 'id' | 'createdAt' | 'createdBy'>>,
//     userId: string
//   ): Promise<Item> {
//     const existing = await this.itemRepo.getById(id);
//     if (!existing) {
//       throw new Error('Item not found');
//     }

//     // Validation: If item code is being changed, check uniqueness
//     if (data.itemCode && data.itemCode !== existing.itemCode) {
//       const codeExists = await this.itemRepo.codeExists(data.itemCode, id);
//       if (codeExists) {
//         throw new Error(`Item code '${data.itemCode}' already exists`);
//       }
//     }

//     // Validation: Max stock >= Min stock
//     const newMinStock = data.minStock !== undefined ? data.minStock : existing.minStock;
//     const newMaxStock = data.maxStock !== undefined ? data.maxStock : existing.maxStock;
    
//     if (newMaxStock < newMinStock) {
//       throw new Error('Maximum stock must be greater than or equal to minimum stock');
//     }

//     // Validation: Cannot deactivate if has active inventory
//     if (data.status === 'inactive') {
//       const inventory = await this.inventoryRepo.getByItemId(id);
//       if (inventory && inventory.availableStock > 0) {
//         throw new Error('Cannot deactivate item with existing stock. Please reduce stock to zero first.');
//       }
//     }

//     const updated = await this.itemRepo.update(id, {
//       ...data,
//       updatedAt: new Date().toISOString(),
//       updatedBy: userId
//     });

//     if (!updated) {
//       throw new Error('Failed to update item');
//     }

//     return updated;
//   }

//   /**
//    * Delete item (soft delete)
//    * Business Rules:
//    * - Cannot delete if inventory exists
//    * - Cannot delete if has blanket orders
//    */
//   async deleteItem(id: string): Promise<boolean> {
//     const existing = await this.itemRepo.getById(id);
//     if (!existing) {
//       throw new Error('Item not found');
//     }

//     // Validation: Cannot delete if has stock
//     const inventory = await this.inventoryRepo.getByItemId(id);
//     if (inventory && (inventory.availableStock > 0 || inventory.reservedStock > 0)) {
//       throw new Error('Cannot delete item with existing stock');
//     }

//     return await this.itemRepo.delete(id);
//   }
// }

// services/ItemService.ts
import { ItemRepository } from '../repositories/ItemRepository.ts';

export class ItemService {
  private repo: ItemRepository;

  constructor() {
    this.repo = new ItemRepository();
  }

  async getAllItems() {
    return await this.repo.getAllItems();
  }

  async getItemById(id: string) {
    if (!id) {
      throw new Error('Item ID is required');
    }
    return await this.repo.getItemById(id);
  }

  async createItem(payload: any, userId: string) {
    this.validateItemPayload(payload);
    return await this.repo.createItem(payload, userId);
  }

  async updateItem(id: string, payload: any, userId: string) {
    if (!id) {
      throw new Error('Item ID is required');
    }
    this.validateItemPayload(payload, true);
    return await this.repo.updateItem(id, payload, userId);
  }

  async deleteItem(id: string) {
    if (!id) {
      throw new Error('Item ID is required');
    }
    await this.repo.deleteItem(id);
  }

  private validateItemPayload(payload: any, isUpdate = false) {
    if (!isUpdate && !payload.item_code) {
      throw new Error('Item code is required');
    }
    if (!payload.item_name) {
      throw new Error('Item name is required');
    }

    if (payload.min_stock_level < 0 ||
        payload.max_stock_level < 0 ||
        payload.safety_stock < 0) {
      throw new Error('Stock levels cannot be negative');
    }

    if (payload.max_stock_level < payload.min_stock_level) {
      throw new Error('Max stock must be greater than or equal to min stock');
    }
  }
}
