// /**
//  * Blanket Order Service - Business Logic Layer
//  * Handles blanket orders and order lines
//  */

// import { BlanketOrderRepository, BlanketOrder, BlanketOrderLine } from '../repositories/BlanketOrderRepository.ts';
// import { ItemRepository } from '../repositories/ItemRepository.ts';

// export class BlanketOrderService {
//   constructor(
//     private blanketOrderRepo: BlanketOrderRepository,
//     private itemRepo: ItemRepository
//   ) {}

//   /**
//    * Create blanket order with lines
//    */
//   async createOrder(
//     data: {
//       orderNumber: string;
//       customerName: string;
//       customerCode?: string;
//       orderDate: string;
//       startDate: string;
//       endDate: string;
//       lines: Array<{
//         itemId: string;
//         totalQuantity: number;
//         unitPrice?: number;
//       }>;
//     },
//     userId: string
//   ): Promise<{ order: BlanketOrder; lines: BlanketOrderLine[] }> {
    
//     // Validation: End date must be >= Start date
//     if (data.endDate < data.startDate) {
//       throw new Error('End date must be on or after start date');
//     }

//     // Validation: Order number must be unique
//     const allOrders = await this.blanketOrderRepo.getAllOrders();
//     const orderExists = allOrders.some(o => o.orderNumber === data.orderNumber);
//     if (orderExists) {
//       throw new Error(`Order number '${data.orderNumber}' already exists`);
//     }

//     // Validation: Must have at least one line
//     if (!data.lines || data.lines.length === 0) {
//       throw new Error('Order must have at least one line item');
//     }

//     // Validation: All items must exist
//     for (const lineData of data.lines) {
//       const item = await this.itemRepo.getById(lineData.itemId);
//       if (!item) {
//         throw new Error(`Item not found: ${lineData.itemId}`);
//       }
//       if (lineData.totalQuantity <= 0) {
//         throw new Error('Line quantity must be greater than zero');
//       }
//     }

//     // Create order
//     const order = await this.blanketOrderRepo.createOrder({
//       orderNumber: data.orderNumber,
//       customerName: data.customerName,
//       customerCode: data.customerCode,
//       orderDate: data.orderDate,
//       startDate: data.startDate,
//       endDate: data.endDate,
//       status: 'ACTIVE',
//       createdAt: new Date().toISOString(),
//       createdBy: userId
//     });

//     // Create lines
//     const lines: BlanketOrderLine[] = [];
//     for (const lineData of data.lines) {
//       const line = await this.blanketOrderRepo.createLine({
//         orderId: order.id,
//         itemId: lineData.itemId,
//         totalQuantity: lineData.totalQuantity,
//         releasedQuantity: 0,
//         deliveredQuantity: 0,
//         unitPrice: lineData.unitPrice,
//         createdAt: new Date().toISOString(),
//         createdBy: userId
//       });
//       lines.push(line);
//     }

//     return { order, lines };
//   }

//   /**
//    * Get all orders
//    */
//   async getAllOrders(): Promise<BlanketOrder[]> {
//     return await this.blanketOrderRepo.getAllOrders();
//   }

//   /**
//    * Get active orders
//    */
//   async getActiveOrders(): Promise<BlanketOrder[]> {
//     return await this.blanketOrderRepo.getActiveOrders();
//   }

//   /**
//    * Get order with lines
//    */
//   async getOrderWithLines(orderId: string): Promise<{
//     order: BlanketOrder;
//     lines: BlanketOrderLine[];
//   } | null> {
//     const order = await this.blanketOrderRepo.getOrderById(orderId);
//     if (!order) {
//       return null;
//     }

//     const lines = await this.blanketOrderRepo.getLinesByOrderId(orderId);
    
//     return { order, lines };
//   }

//   /**
//    * Update order status
//    */
//   async updateOrderStatus(
//     orderId: string,
//     status: BlanketOrder['status'],
//     userId: string
//   ): Promise<BlanketOrder> {
//     const order = await this.blanketOrderRepo.getOrderById(orderId);
//     if (!order) {
//       throw new Error('Order not found');
//     }

//     const updated = await this.blanketOrderRepo.updateOrder(orderId, {
//       status,
//       updatedAt: new Date().toISOString(),
//       updatedBy: userId
//     });

//     if (!updated) {
//       throw new Error('Failed to update order');
//     }

//     return updated;
//   }

//   /**
//    * Get order statistics
//    */
//   async getOrderStatistics(orderId: string): Promise<{
//     totalQuantity: number;
//     releasedQuantity: number;
//     deliveredQuantity: number;
//     pendingQuantity: number;
//     completionPercentage: number;
//   }> {
//     const lines = await this.blanketOrderRepo.getLinesByOrderId(orderId);
    
//     const totalQuantity = lines.reduce((sum, line) => sum + line.totalQuantity, 0);
//     const releasedQuantity = lines.reduce((sum, line) => sum + line.releasedQuantity, 0);
//     const deliveredQuantity = lines.reduce((sum, line) => sum + line.deliveredQuantity, 0);
//     const pendingQuantity = totalQuantity - deliveredQuantity;
//     const completionPercentage = totalQuantity > 0 
//       ? (deliveredQuantity / totalQuantity) * 100 
//       : 0;

//     return {
//       totalQuantity,
//       releasedQuantity,
//       deliveredQuantity,
//       pendingQuantity,
//       completionPercentage: Math.round(completionPercentage * 100) / 100
//     };
//   }
// }

// services/BlanketOrderService.ts
import { BlanketOrderRepository } from '../repositories/BlanketOrderRepository.ts';

export class BlanketOrderService {
  private repo: BlanketOrderRepository;

  constructor() {
    this.repo = new BlanketOrderRepository();
  }

  async getAllOrders() {
    return await this.repo.getAllOrders();
  }

  async getOrderWithLines(orderId: string) {
    if (!orderId) {
      throw new Error('Order ID is required');
    }
    return await this.repo.getOrderWithLines(orderId);
  }

  async createOrder(order: any, lines: any[], userId: string) {
    this.validateOrder(order);
    this.validateOrderLines(lines);

    const orderHeader = await this.repo.createOrder(order, userId);

    const enrichedLines = lines.map((line) => ({
      ...line,
      blanket_order_id: orderHeader.id
    }));

    await this.repo.createOrderLines(enrichedLines);
    return orderHeader;
  }

  private validateOrder(order: any) {
    if (!order.order_number) {
      throw new Error('Order number is required');
    }
    if (!order.customer_name) {
      throw new Error('Customer name is required');
    }
    if (!order.start_date || !order.end_date) {
      throw new Error('Order start and end dates are required');
    }
  }

  private validateOrderLines(lines: any[]) {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error('At least one order line is required');
    }

    lines.forEach((line) => {
      if (!line.item_code) {
        throw new Error('Item code is required in order line');
      }
      if (!line.ordered_quantity || line.ordered_quantity <= 0) {
        throw new Error('Ordered quantity must be greater than zero');
      }
    });
  }
}
