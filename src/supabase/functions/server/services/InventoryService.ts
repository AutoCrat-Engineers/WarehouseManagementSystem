// /**
//  * Inventory Service - Business Logic Layer
//  * Handles all business operations for Inventory Management
//  */

// import { InventoryRepository, Inventory, StockMovement } from '../repositories/InventoryRepository.ts';
// import { ItemRepository } from '../repositories/ItemRepository.ts';

// export class InventoryService {
//   constructor(
//     private inventoryRepo: InventoryRepository,
//     private itemRepo: ItemRepository
//   ) {}

//   /**
//    * Get all inventory records
//    */
//   async getAllInventory(): Promise<Inventory[]> {
//     return await this.inventoryRepo.getAll();
//   }

//   /**
//    * Get inventory for specific item
//    */
//   async getInventoryByItemId(itemId: string): Promise<Inventory | null> {
//     return await this.inventoryRepo.getByItemId(itemId);
//   }

//   /**
//    * Adjust stock (IN, OUT, or ADJUSTMENT)
//    * Business Rules:
//    * - Item must exist
//    * - Quantity must be positive
//    * - Cannot reduce stock below 0
//    * - Reason is mandatory
//    * - Creates stock movement record
//    * - Updates inventory automatically
//    */
//   async adjustStock(
//     itemId: string,
//     adjustmentData: {
//       movementType: 'IN' | 'OUT' | 'ADJUSTMENT';
//       transactionType: string; // PRODUCTION, SHIPMENT, ADJUSTMENT, etc.
//       quantity: number;
//       reason: string;
//       notes?: string;
//       referenceType?: string;
//       referenceId?: string;
//       referenceNumber?: string;
//     },
//     userId: string
//   ): Promise<{ inventory: Inventory; movement: StockMovement }> {
    
//     // Validation: Item must exist
//     const item = await this.itemRepo.getById(itemId);
//     if (!item) {
//       throw new Error('Item not found');
//     }

//     // Validation: Quantity must be positive
//     if (adjustmentData.quantity <= 0) {
//       throw new Error('Quantity must be greater than zero');
//     }

//     // Validation: Reason is mandatory
//     if (!adjustmentData.reason || adjustmentData.reason.trim() === '') {
//       throw new Error('Reason is required for stock movement');
//     }

//     // Get current inventory
//     let inventory = await this.inventoryRepo.getByItemId(itemId);
    
//     // If no inventory exists, create it
//     if (!inventory) {
//       inventory = await this.inventoryRepo.create(itemId, userId);
//     }

//     const currentStock = inventory.availableStock;
//     let newStock = currentStock;

//     // Calculate new stock based on movement type
//     if (adjustmentData.movementType === 'IN') {
//       newStock = currentStock + adjustmentData.quantity;
//     } else if (adjustmentData.movementType === 'OUT') {
//       newStock = currentStock - adjustmentData.quantity;
      
//       // Validation: Cannot reduce stock below 0
//       if (newStock < 0) {
//         throw new Error(
//           `Insufficient stock. Current: ${currentStock}, Requested: ${adjustmentData.quantity}`
//         );
//       }
//     } else if (adjustmentData.movementType === 'ADJUSTMENT') {
//       // For adjustment, quantity is the new absolute value
//       newStock = adjustmentData.quantity;
//     }

//     // Create stock movement record
//     const movement = await this.inventoryRepo.createMovement({
//       itemId,
//       movementType: adjustmentData.movementType,
//       transactionType: adjustmentData.transactionType,
//       quantity: adjustmentData.quantity,
//       balanceAfter: newStock,
//       referenceType: adjustmentData.referenceType,
//       referenceId: adjustmentData.referenceId,
//       referenceNumber: adjustmentData.referenceNumber,
//       reason: adjustmentData.reason,
//       notes: adjustmentData.notes,
//       createdBy: userId
//     });

//     // Update inventory
//     const updatedInventory = await this.inventoryRepo.updateStock(
//       itemId,
//       newStock,
//       undefined,
//       undefined,
//       userId
//     );

//     if (!updatedInventory) {
//       throw new Error('Failed to update inventory');
//     }

//     // Update last movement info
//     updatedInventory.lastMovementDate = movement.createdAt;
//     updatedInventory.lastMovementType = movement.movementType;
//     await this.inventoryRepo.updateStock(
//       itemId,
//       updatedInventory.availableStock,
//       updatedInventory.reservedStock,
//       updatedInventory.inTransitStock,
//       userId
//     );

//     return {
//       inventory: updatedInventory,
//       movement
//     };
//   }

//   /**
//    * Get stock movements for an item
//    */
//   async getStockMovements(itemId: string, limit?: number): Promise<StockMovement[]> {
//     return await this.inventoryRepo.getMovements(itemId, limit);
//   }

//   /**
//    * Get all stock movements (for ledger view)
//    */
//   async getAllStockMovements(limit: number = 100): Promise<StockMovement[]> {
//     return await this.inventoryRepo.getAllMovements(limit);
//   }

//   /**
//    * Reserve stock for blanket order
//    */
//   async reserveStock(
//     itemId: string,
//     quantity: number,
//     userId: string
//   ): Promise<Inventory> {
//     // Validation: Item must exist
//     const item = await this.itemRepo.getById(itemId);
//     if (!item) {
//       throw new Error('Item not found');
//     }

//     // Validation: Quantity must be positive
//     if (quantity <= 0) {
//       throw new Error('Quantity must be greater than zero');
//     }

//     // Get current inventory
//     const inventory = await this.inventoryRepo.getByItemId(itemId);
//     if (!inventory) {
//       throw new Error('Inventory not found for this item');
//     }

//     // Validation: Must have enough available stock
//     if (inventory.availableStock < quantity) {
//       throw new Error(
//         `Insufficient available stock. Available: ${inventory.availableStock}, Requested: ${quantity}`
//       );
//     }

//     // Move from available to reserved
//     const newAvailable = inventory.availableStock - quantity;
//     const newReserved = inventory.reservedStock + quantity;

//     const updated = await this.inventoryRepo.updateStock(
//       itemId,
//       newAvailable,
//       newReserved,
//       undefined,
//       userId
//     );

//     if (!updated) {
//       throw new Error('Failed to reserve stock');
//     }

//     return updated;
//   }

//   /**
//    * Release reserved stock (e.g., when blanket order is cancelled)
//    */
//   async releaseReservedStock(
//     itemId: string,
//     quantity: number,
//     userId: string
//   ): Promise<Inventory> {
//     const inventory = await this.inventoryRepo.getByItemId(itemId);
//     if (!inventory) {
//       throw new Error('Inventory not found');
//     }

//     if (inventory.reservedStock < quantity) {
//       throw new Error('Not enough reserved stock to release');
//     }

//     // Move from reserved back to available
//     const newAvailable = inventory.availableStock + quantity;
//     const newReserved = inventory.reservedStock - quantity;

//     const updated = await this.inventoryRepo.updateStock(
//       itemId,
//       newAvailable,
//       newReserved,
//       undefined,
//       userId
//     );

//     if (!updated) {
//       throw new Error('Failed to release reserved stock');
//     }

//     return updated;
//   }

//   /**
//    * Get total stock value across all items
//    */
//   async getTotalStockValue(): Promise<number> {
//     return await this.inventoryRepo.getTotalStockValue();
//   }
// }

// services/InventoryService.ts
import { InventoryRepository } from '../repositories/InventoryRepository.ts';

export class InventoryService {
  private repo: InventoryRepository;

  constructor() {
    this.repo = new InventoryRepository();
  }

  async getAllInventory() {
    return await this.repo.getAllInventory();
  }

  async getInventoryByItemCode(itemCode: string) {
    if (!itemCode) {
      throw new Error('Item code is required');
    }
    return await this.repo.getInventoryByItemCode(itemCode);
  }

  async getRecentStockMovements(limit = 100) {
    return await this.repo.getStockMovements(limit);
  }

  async adjustInventory(payload: any, userId: string) {
    this.validateAdjustment(payload);

    return await this.repo.insertStockMovement({
      item_code: payload.item_code,
      movement_type: 'ADJUSTMENT',
      transaction_type: 'MANUAL_ADJUSTMENT',
      quantity: payload.quantity,
      balance_after: payload.balance_after,
      reason: payload.reason
    }, userId);
  }

  private validateAdjustment(payload: any) {
    if (!payload.item_code) {
      throw new Error('Item code is required');
    }
    if (payload.quantity <= 0) {
      throw new Error('Quantity must be greater than zero');
    }
    if (!payload.reason) {
      throw new Error('Reason is required for inventory adjustment');
    }
  }
}
