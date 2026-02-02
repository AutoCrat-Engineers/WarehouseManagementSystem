// /**
//  * Forecasting Service - Business Logic Layer
//  * Implements Holt-Winters Triple Exponential Smoothing for demand forecasting
//  * 
//  * ALGORITHM EXPLANATION:
//  * ======================
//  * Holt-Winters Triple Exponential Smoothing captures three components:
//  * 1. LEVEL (L): Base demand level
//  * 2. TREND (T): Growth or decline rate
//  * 3. SEASONALITY (S): Recurring patterns (e.g., monthly cycles)
//  * 
//  * FORMULAS:
//  * Level:       L[t] = α × (Y[t] / S[t-m]) + (1-α) × (L[t-1] + T[t-1])
//  * Trend:       T[t] = β × (L[t] - L[t-1]) + (1-β) × T[t-1]
//  * Seasonality: S[t] = γ × (Y[t] / L[t]) + (1-γ) × S[t-m]
//  * Forecast:    F[t+h] = (L[t] + h × T[t]) × S[t+h-m]
//  * 
//  * WHERE:
//  * - α (alpha) = Level smoothing parameter (0-1)
//  * - β (beta) = Trend smoothing parameter (0-1)
//  * - γ (gamma) = Seasonal smoothing parameter (0-1)
//  * - m = Seasonal period (e.g., 12 for monthly data)
//  * - h = Forecast horizon (periods ahead)
//  * - Y[t] = Actual observation at time t
//  */

// import * as kv from '../kv_store.tsx';
// import { BlanketOrderRepository } from '../repositories/BlanketOrderRepository.ts';

// export interface DemandHistory {
//   id: string;
//   itemId: string;
//   demandDate: string; // YYYY-MM format
//   demandQuantity: number;
//   source: string; // BLANKET_RELEASE, SALES_ORDER, etc.
//   createdAt: string;
// }

// export interface ForecastResult {
//   id: string;
//   itemId: string;
//   forecastDate: string;
//   forecastPeriod: 'MONTHLY';
//   forecastedQuantity: number;
//   lowerBound: number;
//   upperBound: number;
//   modelType: 'HOLT_WINTERS';
//   alpha: number;
//   beta: number;
//   gamma: number;
//   generatedAt: string;
//   generatedBy: string;
// }

// export class ForecastingService {
//   private historyPrefix = 'demand-history:';
//   private forecastPrefix = 'forecast:';

//   constructor(
//     private blanketOrderRepo: BlanketOrderRepository
//   ) {}

//   /**
//    * Generate demand forecast using Holt-Winters algorithm
//    * 
//    * @param itemId - Item to forecast
//    * @param forecastMonths - Number of months to forecast ahead (default: 6)
//    * @param userId - User generating forecast
//    */
//   async generateForecast(
//     itemId: string,
//     forecastMonths: number = 6,
//     userId: string
//   ): Promise<ForecastResult[]> {
    
//     // Step 1: Get historical demand data
//     const historicalData = await this.getHistoricalDemand(itemId);
    
//     if (historicalData.length < 12) {
//       throw new Error(
//         `Insufficient historical data. Minimum 12 months required, found ${historicalData.length} months.`
//       );
//     }

//     // Step 2: Extract demand values and sort by date
//     const sortedHistory = historicalData.sort((a, b) => 
//       a.demandDate.localeCompare(b.demandDate)
//     );
    
//     const demandValues = sortedHistory.map(h => h.demandQuantity);
    
//     // Step 3: Run Holt-Winters algorithm
//     const alpha = 0.2;  // Level smoothing
//     const beta = 0.1;   // Trend smoothing
//     const gamma = 0.3;  // Seasonal smoothing
//     const seasonalPeriod = 12; // Monthly seasonality

//     const forecastData = this.holtWintersTripleExponential(
//       demandValues,
//       alpha,
//       beta,
//       gamma,
//       seasonalPeriod,
//       forecastMonths
//     );

//     // Step 4: Create forecast records
//     const forecasts: ForecastResult[] = [];
//     const today = new Date();
    
//     for (let i = 0; i < forecastMonths; i++) {
//       const forecastDate = new Date(today.getFullYear(), today.getMonth() + i + 1, 1);
//       const forecastDateStr = `${forecastDate.getFullYear()}-${String(forecastDate.getMonth() + 1).padStart(2, '0')}`;
      
//       const forecast: ForecastResult = {
//         id: `${this.forecastPrefix}${itemId}:${forecastDateStr}`,
//         itemId,
//         forecastDate: forecastDateStr,
//         forecastPeriod: 'MONTHLY',
//         forecastedQuantity: forecastData.forecast[i],
//         lowerBound: forecastData.lowerBounds[i],
//         upperBound: forecastData.upperBounds[i],
//         modelType: 'HOLT_WINTERS',
//         alpha,
//         beta,
//         gamma,
//         generatedAt: new Date().toISOString(),
//         generatedBy: userId
//       };

//       await kv.set(forecast.id, forecast);
//       forecasts.push(forecast);
//     }

//     return forecasts;
//   }

//   /**
//    * Holt-Winters Triple Exponential Smoothing Implementation
//    * 
//    * This is the core forecasting algorithm
//    */
//   private holtWintersTripleExponential(
//     data: number[],
//     alpha: number,
//     beta: number,
//     gamma: number,
//     seasonalPeriod: number,
//     forecastPeriods: number
//   ): {
//     forecast: number[];
//     lowerBounds: number[];
//     upperBounds: number[];
//   } {
    
//     const n = data.length;
    
//     // Initialize components
//     const level: number[] = new Array(n);
//     const trend: number[] = new Array(n);
//     const seasonal: number[] = new Array(n + forecastPeriods);

//     // Step 1: Initialize seasonal components (first seasonal period)
//     for (let i = 0; i < seasonalPeriod; i++) {
//       seasonal[i] = data[i] / (data.reduce((sum, val) => sum + val, 0) / n);
//     }

//     // Step 2: Initialize level and trend
//     level[0] = data[0];
//     trend[0] = data.length >= seasonalPeriod 
//       ? (data[seasonalPeriod] - data[0]) / seasonalPeriod 
//       : 0;

//     // Step 3: Fit the model (smooth the historical data)
//     for (let t = 0; t < n; t++) {
//       if (t === 0) continue;

//       const seasonalIndex = t % seasonalPeriod;
      
//       // Update level
//       const prevLevel = level[t - 1];
//       const prevTrend = trend[t - 1];
//       const prevSeasonal = seasonal[seasonalIndex];
      
//       level[t] = alpha * (data[t] / prevSeasonal) + (1 - alpha) * (prevLevel + prevTrend);
      
//       // Update trend
//       trend[t] = beta * (level[t] - prevLevel) + (1 - beta) * prevTrend;
      
//       // Update seasonality
//       seasonal[seasonalIndex] = gamma * (data[t] / level[t]) + (1 - gamma) * prevSeasonal;
//     }

//     // Step 4: Generate forecasts
//     const forecast: number[] = [];
//     const lowerBounds: number[] = [];
//     const upperBounds: number[] = [];
    
//     const lastLevel = level[n - 1];
//     const lastTrend = trend[n - 1];
    
//     // Calculate standard error for confidence intervals
//     const errors: number[] = [];
//     for (let t = seasonalPeriod; t < n; t++) {
//       const seasonalIndex = t % seasonalPeriod;
//       const predicted = (level[t - 1] + trend[t - 1]) * seasonal[seasonalIndex];
//       errors.push(Math.abs(data[t] - predicted));
//     }
//     const meanError = errors.reduce((sum, err) => sum + err, 0) / errors.length;
//     const stdError = Math.sqrt(
//       errors.reduce((sum, err) => sum + Math.pow(err - meanError, 2), 0) / errors.length
//     );

//     for (let h = 1; h <= forecastPeriods; h++) {
//       const seasonalIndex = (n + h - 1) % seasonalPeriod;
      
//       // Point forecast
//       const forecastValue = Math.max(0, (lastLevel + h * lastTrend) * seasonal[seasonalIndex]);
//       forecast.push(Math.round(forecastValue));
      
//       // 95% confidence interval (±1.96 standard errors)
//       const margin = 1.96 * stdError * Math.sqrt(h);
//       lowerBounds.push(Math.max(0, Math.round(forecastValue - margin)));
//       upperBounds.push(Math.round(forecastValue + margin));
//     }

//     return { forecast, lowerBounds, upperBounds };
//   }

//   /**
//    * Get historical demand data for an item
//    * Sources: Blanket releases, stock movements (OUT), sales orders
//    */
//   private async getHistoricalDemand(itemId: string): Promise<DemandHistory[]> {
//     // Get from blanket releases
//     const releases = await this.blanketOrderRepo.getReleasesByItemId(itemId);
    
//     // Aggregate by month
//     const monthlyDemand: { [key: string]: number } = {};
    
//     for (const release of releases) {
//       if (release.status === 'DELIVERED' && release.actualDeliveryDate) {
//         const month = release.actualDeliveryDate.substring(0, 7); // YYYY-MM
//         monthlyDemand[month] = (monthlyDemand[month] || 0) + release.deliveredQuantity;
//       }
//     }

//     // Convert to history records
//     const history: DemandHistory[] = [];
//     for (const [month, quantity] of Object.entries(monthlyDemand)) {
//       history.push({
//         id: `${this.historyPrefix}${itemId}:${month}`,
//         itemId,
//         demandDate: month,
//         demandQuantity: quantity,
//         source: 'BLANKET_RELEASE',
//         createdAt: new Date().toISOString()
//       });
//     }

//     return history;
//   }

//   /**
//    * Get latest forecast for an item
//    */
//   async getLatestForecast(itemId: string): Promise<ForecastResult[]> {
//     const allForecasts = await kv.getByPrefix(`${this.forecastPrefix}${itemId}:`);
    
//     // Group by forecast date and get most recent generation
//     const latestByDate: { [key: string]: any } = {};
    
//     for (const forecast of allForecasts) {
//       const date = forecast.forecastDate;
//       if (!latestByDate[date] || 
//           new Date(forecast.generatedAt) > new Date(latestByDate[date].generatedAt)) {
//         latestByDate[date] = forecast;
//       }
//     }

//     return Object.values(latestByDate) as ForecastResult[];
//   }

//   /**
//    * Calculate forecast accuracy (after actual data is available)
//    */
//   async calculateForecastAccuracy(itemId: string, forecastDate: string): Promise<number> {
//     const forecastId = `${this.forecastPrefix}${itemId}:${forecastDate}`;
//     const forecast = await kv.get(forecastId);
    
//     if (!forecast) {
//       throw new Error('Forecast not found');
//     }

//     const actualDemand = await this.getActualDemand(itemId, forecastDate);
    
//     if (actualDemand === null) {
//       throw new Error('Actual demand data not yet available');
//     }

//     // Calculate Mean Absolute Percentage Error (MAPE)
//     const error = Math.abs(actualDemand - forecast.forecastedQuantity);
//     const accuracy = actualDemand > 0 ? (1 - (error / actualDemand)) * 100 : 0;

//     return Math.max(0, Math.min(100, accuracy));
//   }

//   /**
//    * Get actual demand for a specific month
//    */
//   private async getActualDemand(itemId: string, demandDate: string): Promise<number | null> {
//     const historyId = `${this.historyPrefix}${itemId}:${demandDate}`;
//     const history = await kv.get(historyId);
    
//     return history ? history.demandQuantity : null;
//   }
// }

// services/ForecastingService.ts
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export class ForecastingService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
  }

  /**
   * Get historical demand for an item
   */
  async getDemandHistory(itemCode: string, fromDate?: string, toDate?: string) {
    if (!itemCode) {
      throw new Error('Item code is required');
    }

    let query = this.supabase
      .from('demand_history')
      .select('*')
      .eq('item_code', itemCode)
      .order('demand_date', { ascending: true });

    if (fromDate) query = query.gte('demand_date', fromDate);
    if (toDate) query = query.lte('demand_date', toDate);

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * Save forecast result (output of any forecasting model)
   */
  async saveForecast(payload: {
    item_code: string;
    forecast_date: string;
    forecast_period: string;
    forecasted_quantity: number;
    lower_bound?: number;
    upper_bound?: number;
    model_type?: string;
    alpha?: number;
    beta?: number;
    gamma?: number;
    seasonal_periods?: number;
  }) {
    this.validateForecastPayload(payload);

    const { data, error } = await this.supabase
      .from('demand_forecasts')
      .insert({
        item_code: payload.item_code,
        forecast_date: payload.forecast_date,
        forecast_period: payload.forecast_period,
        forecasted_quantity: payload.forecasted_quantity,
        lower_bound: payload.lower_bound,
        upper_bound: payload.upper_bound,
        model_type: payload.model_type ?? 'HOLT_WINTERS',
        alpha: payload.alpha,
        beta: payload.beta,
        gamma: payload.gamma,
        seasonal_periods: payload.seasonal_periods
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * Get latest forecasts for dashboard / planning
   */
  async getLatestForecasts(itemCode?: string) {
    let query = this.supabase
      .from('demand_forecasts')
      .select('*')
      .order('forecast_date', { ascending: false });

    if (itemCode) query = query.eq('item_code', itemCode);

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return data;
  }

  private validateForecastPayload(payload: any) {
    if (!payload.item_code) {
      throw new Error('Item code is required');
    }
    if (!payload.forecast_date) {
      throw new Error('Forecast date is required');
    }
    if (!payload.forecast_period) {
      throw new Error('Forecast period is required');
    }
    if (payload.forecasted_quantity < 0) {
      throw new Error('Forecasted quantity cannot be negative');
    }
  }
}
