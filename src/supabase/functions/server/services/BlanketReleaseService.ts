// /**
//  * Blanket Release Service - Business Logic Layer
//  * Handles delivery call-offs with AUTOMATIC inventory updates
//  * 
//  * KEY FEATURE: Auto-Deduction of Inventory
//  * ==========================================
//  * When a blanket release status changes to 'DELIVERED':
//  * 1. Update delivered quantity in order line
//  * 2. Create stock movement record (OUT)
//  * 3. Reduce inventory automatically
//  * 4. Record actual demand for forecasting
//  * 
//  * This is FULLY AUTOMATIC - no manual steps required
//  */

// import { BlanketOrderRepository, BlanketRelease, BlanketOrder, BlanketOrderLine } from '../repositories/BlanketOrderRepository.ts';
// import { InventoryService } from './InventoryService.ts';
// import { ItemRepository } from '../repositories/ItemRepository.ts';

// export class BlanketReleaseService {
//   constructor(
//     private blanketOrderRepo: BlanketOrderRepository,
//     private inventoryService: InventoryService,
//     private itemRepo: ItemRepository
//   ) {}

//   /**
//    * Create blanket release
//    * Business Rules:
//    * - Order must exist and be active
//    * - Order line must exist
//    * - Requested quantity must not exceed remaining quantity
//    * - Delivery date must be within order validity period
//    */
//   async createRelease(
//     data: {
//       releaseNumber: string;
//       orderId: string;
//       lineId: string;
//       itemId: string;
//       releaseDate: string;
//       requestedDeliveryDate: string;
//       requestedQuantity: number;
//       notes?: string;
//     },
//     userId: string
//   ): Promise<BlanketRelease> {
    
//     // Validation: Order must exist and be active
//     const order = await this.blanketOrderRepo.getOrderById(data.orderId);
//     if (!order) {
//       throw new Error('Blanket order not found');
//     }
//     if (order.status !== 'ACTIVE') {
//       throw new Error('Cannot create release for inactive order');
//     }

//     // Validation: Order line must exist
//     const line = await this.blanketOrderRepo.getLineById(data.lineId);
//     if (!line) {
//       throw new Error('Order line not found');
//     }

//     // Validation: Line must belong to this order
//     if (line.orderId !== data.orderId) {
//       throw new Error('Order line does not belong to this order');
//     }

//     // Validation: Item must match
//     if (line.itemId !== data.itemId) {
//       throw new Error('Item mismatch between release and order line');
//     }

//     // Validation: Check remaining quantity
//     const remainingQuantity = line.totalQuantity - line.deliveredQuantity;
//     if (data.requestedQuantity > remainingQuantity) {
//       throw new Error(
//         `Requested quantity (${data.requestedQuantity}) exceeds remaining quantity (${remainingQuantity})`
//       );
//     }

//     // Validation: Requested quantity must be positive
//     if (data.requestedQuantity <= 0) {
//       throw new Error('Requested quantity must be greater than zero');
//     }

//     // Create release
//     const release = await this.blanketOrderRepo.createRelease({
//       releaseNumber: data.releaseNumber,
//       orderId: data.orderId,
//       lineId: data.lineId,
//       itemId: data.itemId,
//       releaseDate: data.releaseDate,
//       requestedDeliveryDate: data.requestedDeliveryDate,
//       requestedQuantity: data.requestedQuantity,
//       deliveredQuantity: 0,
//       status: 'PENDING',
//       notes: data.notes,
//       createdAt: new Date().toISOString(),
//       createdBy: userId
//     });

//     return release;
//   }

//   /**
//    * Update release status
//    * CRITICAL: When status changes to DELIVERED, triggers automatic inventory deduction
//    */
//   async updateReleaseStatus(
//     releaseId: string,
//     newStatus: BlanketRelease['status'],
//     deliveredQuantity?: number,
//     actualDeliveryDate?: string,
//     userId?: string
//   ): Promise<BlanketRelease> {
    
//     const release = await this.blanketOrderRepo.getReleaseById(releaseId);
//     if (!release) {
//       throw new Error('Release not found');
//     }

//     const oldStatus = release.status;

//     // If changing to DELIVERED, perform automatic inventory deduction
//     if (newStatus === 'DELIVERED' && oldStatus !== 'DELIVERED') {
//       return await this.processDelivery(
//         releaseId,
//         deliveredQuantity || release.requestedQuantity,
//         actualDeliveryDate || new Date().toISOString().split('T')[0],
//         userId || 'system'
//       );
//     }

//     // For other status changes, just update
//     const updated = await this.blanketOrderRepo.updateRelease(releaseId, {
//       status: newStatus,
//       ...(actualDeliveryDate && { actualDeliveryDate }),
//       ...(deliveredQuantity !== undefined && { deliveredQuantity }),
//       updatedAt: new Date().toISOString(),
//       ...(userId && { updatedBy: userId })
//     });

//     if (!updated) {
//       throw new Error('Failed to update release');
//     }

//     return updated;
//   }

//   /**
//    * Process delivery - AUTOMATIC INVENTORY UPDATE
//    * This is the core auto-deduction logic
//    */
//   private async processDelivery(
//     releaseId: string,
//     deliveredQuantity: number,
//     actualDeliveryDate: string,
//     userId: string
//   ): Promise<BlanketRelease> {
    
//     const release = await this.blanketOrderRepo.getReleaseById(releaseId);
//     if (!release) {
//       throw new Error('Release not found');
//     }

//     // Validation: Delivered quantity must not exceed requested quantity
//     if (deliveredQuantity > release.requestedQuantity) {
//       throw new Error(
//         `Delivered quantity (${deliveredQuantity}) cannot exceed requested quantity (${release.requestedQuantity})`
//       );
//     }

//     // Get item details for logging
//     const item = await this.itemRepo.getById(release.itemId);
//     if (!item) {
//       throw new Error('Item not found');
//     }

//     // Step 1: Update blanket release status to DELIVERED
//     const updatedRelease = await this.blanketOrderRepo.updateRelease(releaseId, {
//       status: 'DELIVERED',
//       deliveredQuantity,
//       actualDeliveryDate,
//       updatedAt: new Date().toISOString(),
//       updatedBy: userId
//     });

//     if (!updatedRelease) {
//       throw new Error('Failed to update release');
//     }

//     // Step 2: Update delivered quantity in order line
//     const line = await this.blanketOrderRepo.getLineById(release.lineId);
//     if (line) {
//       await this.blanketOrderRepo.updateLine(line.id, {
//         deliveredQuantity: line.deliveredQuantity + deliveredQuantity
//       });
//     }

//     // Step 3: AUTOMATIC INVENTORY DEDUCTION
//     // Create stock movement (OUT) which will automatically reduce inventory
//     try {
//       await this.inventoryService.adjustStock(
//         release.itemId,
//         {
//           movementType: 'OUT',
//           transactionType: 'BLANKET_RELEASE',
//           quantity: deliveredQuantity,
//           reason: `Blanket Release ${release.releaseNumber} delivered`,
//           notes: `Order: ${release.orderId}, Delivery Date: ${actualDeliveryDate}`,
//           referenceType: 'BLANKET_RELEASE',
//           referenceId: releaseId,
//           referenceNumber: release.releaseNumber
//         },
//         userId
//       );

//       console.log(
//         `✅ AUTO-DEDUCTION: Stock reduced by ${deliveredQuantity} ${item.uom} ` +
//         `for item ${item.itemCode} (Release: ${release.releaseNumber})`
//       );

//     } catch (error) {
//       // If inventory deduction fails, revert release status
//       await this.blanketOrderRepo.updateRelease(releaseId, {
//         status: release.status, // Revert to previous status
//         deliveredQuantity: release.deliveredQuantity,
//         updatedAt: new Date().toISOString(),
//         updatedBy: userId
//       });

//       throw new Error(
//         `Failed to deduct inventory: ${error instanceof Error ? error.message : String(error)}. Release status reverted.`
//       );
//     }

//     // Step 4: Check if order is complete
//     await this.checkOrderCompletion(release.orderId);

//     return updatedRelease;
//   }

//   /**
//    * Check if all order lines are fully delivered and update order status
//    */
//   private async checkOrderCompletion(orderId: string): Promise<void> {
//     const lines = await this.blanketOrderRepo.getLinesByOrderId(orderId);
    
//     const allDelivered = lines.every(
//       line => line.deliveredQuantity >= line.totalQuantity
//     );

//     if (allDelivered) {
//       await this.blanketOrderRepo.updateOrder(orderId, {
//         status: 'COMPLETED',
//         updatedAt: new Date().toISOString()
//       });

//       console.log(`✅ Blanket Order ${orderId} marked as COMPLETED (all deliveries fulfilled)`);
//     }
//   }

//   /**
//    * Get all releases
//    */
//   async getAllReleases(): Promise<BlanketRelease[]> {
//     return await this.blanketOrderRepo.getAllReleases();
//   }

//   /**
//    * Get releases by order ID
//    */
//   async getReleasesByOrderId(orderId: string): Promise<BlanketRelease[]> {
//     return await this.blanketOrderRepo.getReleasesByOrderId(orderId);
//   }

//   /**
//    * Get pending releases (for delivery planning)
//    */
//   async getPendingReleases(): Promise<BlanketRelease[]> {
//     const allReleases = await this.blanketOrderRepo.getAllReleases();
//     return allReleases.filter(r => 
//       r.status === 'PENDING' || r.status === 'CONFIRMED' || r.status === 'IN_TRANSIT'
//     );
//   }

//   /**
//    * Get overdue releases (past requested delivery date)
//    */
//   async getOverdueReleases(): Promise<BlanketRelease[]> {
//     const allReleases = await this.blanketOrderRepo.getAllReleases();
//     const today = new Date().toISOString().split('T')[0];

//     return allReleases.filter(r => 
//       r.status !== 'DELIVERED' && 
//       r.status !== 'CANCELLED' &&
//       r.requestedDeliveryDate < today
//     );
//   }
// }

// services/BlanketReleaseService.ts
import { BlanketReleaseRepository } from '../repositories/BlanketReleaseRepository.ts';

export class BlanketReleaseService {
  private repo: BlanketReleaseRepository;

  constructor() {
    this.repo = new BlanketReleaseRepository();
  }

  async getAllReleases() {
    return await this.repo.getAllReleases();
  }

  async getReleasesByOrderId(orderId: string) {
    if (!orderId) {
      throw new Error('Order ID is required');
    }
    return await this.repo.getReleasesByOrderId(orderId);
  }

  async createRelease(payload: any, userId: string) {
    this.validateRelease(payload);
    return await this.repo.createRelease(payload, userId);
  }

  async markAsDelivered(
    releaseId: string,
    deliveredQuantity: number,
    actualDeliveryDate: string,
    userId: string
  ) {
    if (!releaseId) {
      throw new Error('Release ID is required');
    }
    if (deliveredQuantity <= 0) {
      throw new Error('Delivered quantity must be greater than zero');
    }
    if (!actualDeliveryDate) {
      throw new Error('Actual delivery date is required');
    }

    return await this.repo.updateReleaseStatus(
      releaseId,
      'DELIVERED',
      deliveredQuantity,
      actualDeliveryDate,
      userId
    );
  }

  private validateRelease(payload: any) {
    if (!payload.blanket_order_id) {
      throw new Error('Blanket order ID is required');
    }
    if (!payload.blanket_order_line_id) {
      throw new Error('Blanket order line ID is required');
    }
    if (!payload.item_code) {
      throw new Error('Item code is required');
    }
    if (!payload.requested_quantity || payload.requested_quantity <= 0) {
      throw new Error('Requested quantity must be greater than zero');
    }
    if (!payload.requested_delivery_date) {
      throw new Error('Requested delivery date is required');
    }
  }
}
