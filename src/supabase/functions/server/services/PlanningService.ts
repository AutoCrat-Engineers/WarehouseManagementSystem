// /**
//  * Planning Service - Material Requirements Planning (MRP) Logic
//  * 
//  * PURPOSE OF THIS MODULE:
//  * =======================
//  * The Planning Module bridges FORECASTING and EXECUTION by answering three critical questions:
//  * 1. WHAT to produce/purchase?
//  * 2. HOW MUCH to produce/purchase?
//  * 3. WHEN to produce/purchase?
//  * 
//  * WHY IT EXISTS:
//  * ==============
//  * - Forecasting tells you future demand, but not when to act
//  * - Inventory shows current stock, but doesn't project future needs
//  * - Manual calculations are time-consuming and error-prone
//  * - This module automates the decision-making process
//  * 
//  * HOW IT WORKS (MRP LOGIC):
//  * ==========================
//  * For each item:
//  *   1. Get current available stock
//  *   2. Get reserved stock (for blanket orders)
//  *   3. Get forecasted demand (from forecasting module)
//  *   4. Calculate: Projected Stock = Available - Reserved - Forecasted Demand
//  *   5. Compare projected stock with min/max/safety levels
//  *   6. Generate recommendation with priority level
//  *   7. Consider lead time for recommended action date
//  * 
//  * OPERATIONAL USE:
//  * ================
//  * 1. Production Planner opens Planning Module daily/weekly
//  * 2. System shows recommendations sorted by priority (CRITICAL first)
//  * 3. Planner reviews and approves/modifies recommendations
//  * 4. Approved recommendations feed into production scheduling
//  * 5. Production completes → Stock IN → Cycle repeats
//  */

// import * as kv from '../kv_store.tsx';
// import { ItemRepository } from '../repositories/ItemRepository.ts';
// import { InventoryRepository } from '../repositories/InventoryRepository.ts';
// import { BlanketOrderRepository } from '../repositories/BlanketOrderRepository.ts';
// import { ForecastingService } from './ForecastingService.ts';

// export interface PlanningRecommendation {
//   id: string;
//   itemId: string;
//   itemCode: string;
//   itemName: string;
  
//   // Current State
//   currentStock: number;
//   reservedStock: number;
//   availableStock: number;
  
//   // Planning Parameters
//   minStock: number;
//   maxStock: number;
//   safetyStock: number;
//   leadTimeDays: number;
  
//   // Forecast Data
//   forecastedDemand: number;
//   planningHorizonDays: number;
  
//   // Projected State
//   projectedStock: number;
  
//   // Recommendation
//   recommendedAction: 'PRODUCE' | 'PURCHASE' | 'HOLD' | 'CRITICAL' | 'REDUCE';
//   recommendedQuantity: number;
//   recommendedDate: string;
//   reason: string;
//   priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
//   status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  
//   // Audit
//   generatedAt: string;
//   generatedBy: string;
// }

// export class PlanningService {
//   private planningPrefix = 'planning:';

//   constructor(
//     private itemRepo: ItemRepository,
//     private inventoryRepo: InventoryRepository,
//     private blanketOrderRepo: BlanketOrderRepository,
//     private forecastingService: ForecastingService
//   ) {}

//   /**
//    * Run MRP calculation for all active items
//    */
//   async runMRP(
//     planningHorizonDays: number = 90,
//     userId: string
//   ): Promise<PlanningRecommendation[]> {
    
//     const items = await this.itemRepo.getActive();
//     const recommendations: PlanningRecommendation[] = [];

//     for (const item of items) {
//       try {
//         const recommendation = await this.calculateMRPForItem(
//           item.id,
//           planningHorizonDays,
//           userId
//         );
//         recommendations.push(recommendation);
//       } catch (error) {
//         console.error(`Error calculating MRP for item ${item.itemCode}:`, error);
//         // Continue with other items
//       }
//     }

//     return recommendations;
//   }

//   /**
//    * Calculate MRP for a single item
//    * This is the core planning algorithm
//    */
//   async calculateMRPForItem(
//     itemId: string,
//     planningHorizonDays: number = 90,
//     userId: string
//   ): Promise<PlanningRecommendation> {
    
//     // Step 1: Get item master data
//     const item = await this.itemRepo.getById(itemId);
//     if (!item) {
//       throw new Error('Item not found');
//     }

//     // Step 2: Get current inventory
//     const inventory = await this.inventoryRepo.getByItemId(itemId);
//     if (!inventory) {
//       throw new Error('Inventory not found for item');
//     }

//     // Step 3: Get reserved stock (from active blanket orders)
//     const reserved = await this.blanketOrderRepo.getReservedQuantityByItem(itemId);

//     // Step 4: Get forecasted demand for planning horizon
//     const forecastMonths = Math.ceil(planningHorizonDays / 30);
//     let forecastedDemand = 0;
    
//     try {
//       const forecasts = await this.forecastingService.getLatestForecast(itemId);
      
//       // Sum forecasted demand for the planning horizon
//       const today = new Date();
//       for (const forecast of forecasts) {
//         const forecastDate = new Date(forecast.forecastDate + '-01');
//         const daysDiff = Math.floor((forecastDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
//         if (daysDiff >= 0 && daysDiff <= planningHorizonDays) {
//           forecastedDemand += forecast.forecastedQuantity;
//         }
//       }
//     } catch (error) {
//       // If no forecast exists, use average historical demand or 0
//       console.warn(`No forecast available for item ${item.itemCode}, using 0 demand`);
//       forecastedDemand = 0;
//     }

//     // Step 5: Calculate net available and projected stock
//     const currentStock = inventory.availableStock;
//     const netAvailable = currentStock - reserved;
//     const projectedStock = netAvailable - forecastedDemand;

//     // Step 6: Determine recommendation based on projected stock
//     let action: PlanningRecommendation['recommendedAction'];
//     let quantity: number;
//     let priority: PlanningRecommendation['priority'];
//     let reason: string;

//     if (projectedStock < 0) {
//       // CRITICAL: Will stock out
//       action = 'CRITICAL';
//       quantity = Math.abs(projectedStock) + item.safetyStock;
//       priority = 'CRITICAL';
//       reason = `STOCK-OUT ALERT: Projected stock is ${projectedStock.toFixed(0)} ${item.uom}. ` +
//               `Current stock (${currentStock}) cannot cover reserved (${reserved}) + forecasted demand (${forecastedDemand}). ` +
//               `Recommend IMMEDIATE production/purchase of ${quantity.toFixed(0)} ${item.uom} to avoid stock-out and restore safety levels.`;
              
//     } else if (projectedStock < item.minStock) {
//       // HIGH: Below minimum
//       action = 'PRODUCE';
//       quantity = item.maxStock - projectedStock;
//       priority = 'HIGH';
//       reason = `Stock will fall below minimum level (${item.minStock} ${item.uom}). ` +
//               `Projected stock: ${projectedStock.toFixed(0)} ${item.uom}. ` +
//               `Recommend production of ${quantity.toFixed(0)} ${item.uom} to reach maximum stock level (${item.maxStock} ${item.uom}).`;
              
//     } else if (projectedStock < item.safetyStock) {
//       // MEDIUM: Below safety stock
//       action = 'PRODUCE';
//       quantity = item.maxStock - projectedStock;
//       priority = 'MEDIUM';
//       reason = `Stock will fall below safety level (${item.safetyStock} ${item.uom}). ` +
//               `Projected stock: ${projectedStock.toFixed(0)} ${item.uom}. ` +
//               `Recommend production of ${quantity.toFixed(0)} ${item.uom} to maintain buffer levels.`;
              
//     } else if (currentStock > item.maxStock) {
//       // LOW: Overstock
//       action = 'REDUCE';
//       quantity = 0;
//       priority = 'LOW';
//       reason = `Current stock (${currentStock.toFixed(0)} ${item.uom}) exceeds maximum level (${item.maxStock} ${item.uom}). ` +
//               `Overstock: ${(currentStock - item.maxStock).toFixed(0)} ${item.uom}. ` +
//               `Consider reducing production or accelerating sales.`;
              
//     } else {
//       // OK: Healthy levels
//       action = 'HOLD';
//       quantity = 0;
//       priority = 'LOW';
//       reason = `Stock levels are healthy. Current: ${currentStock.toFixed(0)} ${item.uom}, ` +
//               `Projected: ${projectedStock.toFixed(0)} ${item.uom}, ` +
//               `Min: ${item.minStock} ${item.uom}, Max: ${item.maxStock} ${item.uom}. ` +
//               `No action required at this time.`;
//     }

//     // Step 7: Calculate recommended date (today + lead time)
//     const recommendedDate = new Date();
//     recommendedDate.setDate(recommendedDate.getDate() + item.leadTimeDays);

//     // Step 8: Create recommendation record
//     const recommendation: PlanningRecommendation = {
//       id: `${this.planningPrefix}${itemId}:${Date.now()}`,
//       itemId: item.id,
//       itemCode: item.itemCode,
//       itemName: item.itemName,
      
//       currentStock,
//       reservedStock: reserved,
//       availableStock: netAvailable,
      
//       minStock: item.minStock,
//       maxStock: item.maxStock,
//       safetyStock: item.safetyStock,
//       leadTimeDays: item.leadTimeDays,
      
//       forecastedDemand,
//       planningHorizonDays,
      
//       projectedStock,
      
//       recommendedAction: action,
//       recommendedQuantity: Math.round(quantity),
//       recommendedDate: recommendedDate.toISOString().split('T')[0],
//       reason,
//       priority,
//       status: 'PENDING',
      
//       generatedAt: new Date().toISOString(),
//       generatedBy: userId
//     };

//     // Save recommendation
//     await kv.set(recommendation.id, recommendation);

//     return recommendation;
//   }

//   /**
//    * Get latest recommendations for all items
//    */
//   async getLatestRecommendations(): Promise<PlanningRecommendation[]> {
//     const allPlanning = await kv.getByPrefix(this.planningPrefix);
    
//     // Get most recent planning for each item
//     const latestByItem: { [key: string]: PlanningRecommendation } = {};
    
//     for (const plan of allPlanning) {
//       const itemId = plan.itemId;
//       if (!latestByItem[itemId] || 
//           new Date(plan.generatedAt) > new Date(latestByItem[itemId].generatedAt)) {
//         latestByItem[itemId] = plan as PlanningRecommendation;
//       }
//     }

//     // Sort by priority
//     const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
//     return Object.values(latestByItem).sort((a, b) => 
//       priorityOrder[a.priority] - priorityOrder[b.priority]
//     );
//   }

//   /**
//    * Get recommendations by priority
//    */
//   async getRecommendationsByPriority(
//     priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
//   ): Promise<PlanningRecommendation[]> {
//     const allRecommendations = await this.getLatestRecommendations();
//     return allRecommendations.filter(r => r.priority === priority);
//   }

//   /**
//    * Approve recommendation
//    */
//   async approveRecommendation(id: string, userId: string): Promise<PlanningRecommendation> {
//     const recommendation = await kv.get(id);
//     if (!recommendation) {
//       throw new Error('Recommendation not found');
//     }

//     const updated: PlanningRecommendation = {
//       ...recommendation,
//       status: 'APPROVED'
//     };

//     await kv.set(id, updated);
//     return updated;
//   }

//   /**
//    * Reject recommendation
//    */
//   async rejectRecommendation(id: string, userId: string): Promise<PlanningRecommendation> {
//     const recommendation = await kv.get(id);
//     if (!recommendation) {
//       throw new Error('Recommendation not found');
//     }

//     const updated: PlanningRecommendation = {
//       ...recommendation,
//       status: 'REJECTED'
//     };

//     await kv.set(id, updated);
//     return updated;
//   }
// }

// services/PlanningService.ts
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export class PlanningService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
  }

  /**
   * Run planning for all active items
   */
  async runPlanning(planningHorizonDays: number) {
    if (!planningHorizonDays || planningHorizonDays <= 0) {
      throw new Error('Planning horizon must be greater than zero');
    }

    const { data: items, error } = await this.supabase
      .from('items')
      .select(`
        item_code,
        min_stock_level,
        safety_stock,
        reorder_point,
        lead_time_days,
        inventory (
          current_stock,
          reserved_stock,
          available_stock
        )
      `)
      .eq('is_active', true);

    if (error) throw new Error(error.message);

    const recommendations = [];

    for (const item of items ?? []) {
      const availableStock = item.inventory?.available_stock ?? 0;

      const forecastDemand = await this.getForecastDemand(
        item.item_code,
        planningHorizonDays
      );

      const projectedStock = availableStock - forecastDemand;

      const recommendation = this.calculateRecommendation(
        item,
        availableStock,
        forecastDemand,
        projectedStock,
        planningHorizonDays
      );

      recommendations.push(recommendation);
    }

    if (recommendations.length > 0) {
      await this.saveRecommendations(recommendations);
    }

    return recommendations;
  }

  /**
   * Sum forecast demand for horizon
   */
  private async getForecastDemand(itemCode: string, horizonDays: number) {
    const { data, error } = await this.supabase
      .from('demand_forecasts')
      .select('forecasted_quantity')
      .eq('item_code', itemCode);

    if (error) throw new Error(error.message);

    return (data ?? []).reduce(
      (sum, f) => sum + (f.forecasted_quantity || 0),
      0
    );
  }

  /**
   * Core planning logic
   */
  private calculateRecommendation(
    item: any,
    availableStock: number,
    forecastDemand: number,
    projectedStock: number,
    horizonDays: number
  ) {
    let action = 'HOLD';
    let quantity = 0;
    let priority = 'LOW';
    let reason = 'Stock levels are sufficient';

    if (projectedStock <= item.min_stock_level) {
      action = 'CRITICAL';
      quantity = Math.max(
        item.max_stock_level - availableStock,
        item.safety_stock
      );
      priority = 'CRITICAL';
      reason = 'Projected stock below minimum level';
    } else if (projectedStock <= item.reorder_point) {
      action = 'PRODUCE';
      quantity = item.max_stock_level - projectedStock;
      priority = 'HIGH';
      reason = 'Projected stock below reorder point';
    }

    return {
      item_code: item.item_code,
      planning_horizon_days: horizonDays,
      current_stock: item.inventory?.current_stock ?? 0,
      reserved_stock: item.inventory?.reserved_stock ?? 0,
      available_stock: availableStock,
      forecasted_demand: forecastDemand,
      projected_stock: projectedStock,
      recommended_action: action,
      recommended_quantity: quantity,
      recommended_date: this.calculateRecommendedDate(
        item.lead_time_days
      ),
      priority,
      reason,
      status: 'PENDING'
    };
  }

  /**
   * Save planning output
   */
  private async saveRecommendations(recommendations: any[]) {
    const { error } = await this.supabase
      .from('planning_recommendations')
      .insert(recommendations);

    if (error) throw new Error(error.message);
  }

  private calculateRecommendedDate(leadTimeDays: number) {
    const date = new Date();
    date.setDate(date.getDate() + (leadTimeDays ?? 0));
    return date.toISOString().split('T')[0];
  }
}
