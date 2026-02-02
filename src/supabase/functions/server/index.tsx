// // import { Hono } from 'npm:hono';
// // import { cors } from 'npm:hono/cors';
// // import { logger } from 'npm:hono/logger';
// // import { createClient } from 'jsr:@supabase/supabase-js@2';
// // import * as kv from './kv_store.tsx';

// // const app = new Hono();

// // // Middleware
// // app.use('*', cors());
// // app.use('*', logger(console.log));

// // // Initialize Supabase clients
// // // Admin client for server operations (creating users, etc.)
// // const supabaseAdmin = createClient(
// //   Deno.env.get('SUPABASE_URL')!,
// //   Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// // );

// // // Client for validating user tokens from frontend
// // const supabase = createClient(
// //   Deno.env.get('SUPABASE_URL')!,
// //   Deno.env.get('SUPABASE_ANON_KEY')!
// // );

// // // ============================================================================
// // // AUTHENTICATION ROUTES
// // // ============================================================================

// // app.post('/make-server-9c637d11/auth/signup', async (c) => {
// //   try {
// //     const body = await c.req.json();
// //     const { email, password, name, role = 'user' } = body;

// //     const { data, error } = await supabaseAdmin.auth.admin.createUser({
// //       email,
// //       password,
// //       user_metadata: { name, role },
// //       email_confirm: true // Auto-confirm since email server not configured
// //     });

// //     if (error) {
// //       console.error('Signup error:', error);
// //       return c.json({ error: error.message }, 400);
// //     }

// //     return c.json({ success: true, user: data.user });
// //   } catch (error) {
// //     console.error('Signup exception:', error);
// //     return c.json({ error: 'Internal server error during signup' }, 500);
// //   }
// // });

// // // ============================================================================
// // // UTILITY FUNCTIONS
// // // ============================================================================

// // async function getUserFromToken(authHeader: string | null) {
// //   if (!authHeader) {
// //     console.log('getUserFromToken: No authorization header provided');
// //     return null;
// //   }
  
// //   const parts = authHeader.split(' ');
// //   if (parts.length !== 2 || parts[0] !== 'Bearer') {
// //     console.log('getUserFromToken: Invalid authorization header format');
// //     return null;
// //   }
  
// //   const token = parts[1];
// //   if (!token) {
// //     console.log('getUserFromToken: No token found in authorization header');
// //     return null;
// //   }
  
// //   console.log('getUserFromToken: Validating token...');
  
// //   try {
// //     // Use the ANON_KEY client to validate the user's access token
// //     const { data: { user }, error } = await supabase.auth.getUser(token);
    
// //     if (error) {
// //       console.error('getUserFromToken: Auth validation error:', error.message, error);
// //       return null;
// //     }
    
// //     if (!user) {
// //       console.error('getUserFromToken: No user returned from token validation');
// //       return null;
// //     }
    
// //     console.log('getUserFromToken: Successfully validated user:', user.id);
// //     return user;
// //   } catch (error) {
// //     console.error('getUserFromToken: Exception validating token:', error);
// //     return null;
// //   }
// // }

// // // ============================================================================
// // // ITEM MASTER ROUTES
// // // ============================================================================

// // app.get('/make-server-9c637d11/items', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const items = await kv.getByPrefix('item:');
// //     return c.json({ items });
// //   } catch (error) {
// //     console.error('Error fetching items:', error);
// //     return c.json({ error: 'Failed to fetch items' }, 500);
// //   }
// // });

// // app.post('/make-server-9c637d11/items', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const body = await c.req.json();
// //     const itemId = `item:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
// //     const item = {
// //       id: itemId,
// //       itemCode: body.itemCode,
// //       itemName: body.itemName,
// //       uom: body.uom,
// //       minStock: body.minStock,
// //       maxStock: body.maxStock,
// //       safetyStock: body.safetyStock,
// //       leadTimeDays: body.leadTimeDays,
// //       status: body.status || 'active',
// //       createdAt: new Date().toISOString(),
// //       createdBy: user.id
// //     };

// //     await kv.set(itemId, item);
// //     return c.json({ success: true, item });
// //   } catch (error) {
// //     console.error('Error creating item:', error);
// //     return c.json({ error: 'Failed to create item' }, 500);
// //   }
// // });

// // app.put('/make-server-9c637d11/items/:id', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const itemId = c.req.param('id');
// //     const body = await c.req.json();

// //     const existingItem = await kv.get(itemId);
// //     if (!existingItem) {
// //       return c.json({ error: 'Item not found' }, 404);
// //     }

// //     const updatedItem = {
// //       ...existingItem,
// //       ...body,
// //       updatedAt: new Date().toISOString(),
// //       updatedBy: user.id
// //     };

// //     await kv.set(itemId, updatedItem);
// //     return c.json({ success: true, item: updatedItem });
// //   } catch (error) {
// //     console.error('Error updating item:', error);
// //     return c.json({ error: 'Failed to update item' }, 500);
// //   }
// // });

// // app.delete('/make-server-9c637d11/items/:id', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const itemId = c.req.param('id');
// //     await kv.del(itemId);
// //     return c.json({ success: true });
// //   } catch (error) {
// //     console.error('Error deleting item:', error);
// //     return c.json({ error: 'Failed to delete item' }, 500);
// //   }
// // });

// // // ============================================================================
// // // INVENTORY ROUTES
// // // ============================================================================

// // app.get('/make-server-9c637d11/inventory', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const inventory = await kv.getByPrefix('inventory:');
// //     return c.json({ inventory });
// //   } catch (error) {
// //     console.error('Error fetching inventory:', error);
// //     return c.json({ error: 'Failed to fetch inventory' }, 500);
// //   }
// // });

// // app.post('/make-server-9c637d11/inventory', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const body = await c.req.json();
// //     const invId = `inventory:${body.itemId}`;
    
// //     const inventory = {
// //       id: invId,
// //       itemId: body.itemId,
// //       openingStock: body.openingStock || 0,
// //       currentStock: body.currentStock || body.openingStock || 0,
// //       productionInward: 0,
// //       customerOutward: 0,
// //       lastUpdated: new Date().toISOString(),
// //       updatedBy: user.id
// //     };

// //     await kv.set(invId, inventory);
// //     return c.json({ success: true, inventory });
// //   } catch (error) {
// //     console.error('Error creating inventory:', error);
// //     return c.json({ error: 'Failed to create inventory' }, 500);
// //   }
// // });

// // app.put('/make-server-9c637d11/inventory/:itemId/adjust', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const itemId = c.req.param('itemId');
// //     const body = await c.req.json();
// //     const invId = `inventory:${itemId}`;

// //     const inventory = await kv.get(invId);
// //     if (!inventory) {
// //       return c.json({ error: 'Inventory record not found' }, 404);
// //     }

// //     const { type, quantity, reason } = body;
// //     let newStock = inventory.currentStock;

// //     if (type === 'production') {
// //       newStock += quantity;
// //       inventory.productionInward += quantity;
// //     } else if (type === 'shipment') {
// //       newStock -= quantity;
// //       inventory.customerOutward += quantity;
// //     } else if (type === 'adjustment') {
// //       newStock = quantity;
// //     }

// //     inventory.currentStock = newStock;
// //     inventory.lastUpdated = new Date().toISOString();
// //     inventory.updatedBy = user.id;

// //     // Log transaction
// //     const transactionId = `transaction:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
// //     const transaction = {
// //       id: transactionId,
// //       itemId,
// //       type,
// //       quantity,
// //       reason,
// //       previousStock: inventory.currentStock - (type === 'production' ? quantity : -quantity),
// //       newStock,
// //       timestamp: new Date().toISOString(),
// //       userId: user.id
// //     };
// //     await kv.set(transactionId, transaction);

// //     await kv.set(invId, inventory);
// //     return c.json({ success: true, inventory });
// //   } catch (error) {
// //     console.error('Error adjusting inventory:', error);
// //     return c.json({ error: 'Failed to adjust inventory' }, 500);
// //   }
// // });

// // // ============================================================================
// // // BLANKET ORDER ROUTES
// // // ============================================================================

// // app.get('/make-server-9c637d11/blanket-orders', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const orders = await kv.getByPrefix('blanket-order:');
// //     return c.json({ orders });
// //   } catch (error) {
// //     console.error('Error fetching blanket orders:', error);
// //     return c.json({ error: 'Failed to fetch blanket orders' }, 500);
// //   }
// // });

// // app.post('/make-server-9c637d11/blanket-orders', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const body = await c.req.json();
// //     const orderId = `blanket-order:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
// //     const order = {
// //       id: orderId,
// //       orderNumber: body.orderNumber,
// //       customer: body.customer,
// //       itemId: body.itemId,
// //       totalQuantity: body.totalQuantity,
// //       validFrom: body.validFrom,
// //       validTo: body.validTo,
// //       status: body.status || 'active',
// //       createdAt: new Date().toISOString(),
// //       createdBy: user.id
// //     };

// //     await kv.set(orderId, order);
// //     return c.json({ success: true, order });
// //   } catch (error) {
// //     console.error('Error creating blanket order:', error);
// //     return c.json({ error: 'Failed to create blanket order' }, 500);
// //   }
// // });

// // app.put('/make-server-9c637d11/blanket-orders/:id', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const orderId = c.req.param('id');
// //     const body = await c.req.json();

// //     const existingOrder = await kv.get(orderId);
// //     if (!existingOrder) {
// //       return c.json({ error: 'Blanket order not found' }, 404);
// //     }

// //     const updatedOrder = {
// //       ...existingOrder,
// //       ...body,
// //       updatedAt: new Date().toISOString(),
// //       updatedBy: user.id
// //     };

// //     await kv.set(orderId, updatedOrder);
// //     return c.json({ success: true, order: updatedOrder });
// //   } catch (error) {
// //     console.error('Error updating blanket order:', error);
// //     return c.json({ error: 'Failed to update blanket order' }, 500);
// //   }
// // });

// // // ============================================================================
// // // BLANKET RELEASE ROUTES
// // // ============================================================================

// // app.get('/make-server-9c637d11/blanket-releases', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const orderId = c.req.query('orderId');
// //     if (orderId) {
// //       const releases = await kv.getByPrefix(`blanket-release:${orderId}:`);
// //       return c.json({ releases });
// //     }

// //     const releases = await kv.getByPrefix('blanket-release:');
// //     return c.json({ releases });
// //   } catch (error) {
// //     console.error('Error fetching blanket releases:', error);
// //     return c.json({ error: 'Failed to fetch blanket releases' }, 500);
// //   }
// // });

// // app.post('/make-server-9c637d11/blanket-releases', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const body = await c.req.json();
// //     const releaseId = `blanket-release:${body.blanketOrderId}:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
// //     const release = {
// //       id: releaseId,
// //       blanketOrderId: body.blanketOrderId,
// //       releaseNumber: body.releaseNumber,
// //       releaseDate: body.releaseDate,
// //       quantity: body.quantity,
// //       deliveryDate: body.deliveryDate,
// //       status: body.status || 'pending',
// //       createdAt: new Date().toISOString(),
// //       createdBy: user.id
// //     };

// //     await kv.set(releaseId, release);

// //     // If release is fulfilled, update inventory
// //     if (body.status === 'fulfilled') {
// //       const order = await kv.get(body.blanketOrderId);
// //       if (order) {
// //         const invId = `inventory:${order.itemId}`;
// //         const inventory = await kv.get(invId);
// //         if (inventory) {
// //           inventory.currentStock -= body.quantity;
// //           inventory.customerOutward += body.quantity;
// //           inventory.lastUpdated = new Date().toISOString();
// //           await kv.set(invId, inventory);
// //         }
// //       }
// //     }

// //     return c.json({ success: true, release });
// //   } catch (error) {
// //     console.error('Error creating blanket release:', error);
// //     return c.json({ error: 'Failed to create blanket release' }, 500);
// //   }
// // });

// // // ============================================================================
// // // FORECASTING ENGINE (Holt-Winters)
// // // ============================================================================

// // app.post('/make-server-9c637d11/forecast/generate', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const body = await c.req.json();
// //     const { itemId, periods = 6 } = body;

// //     // Get historical releases for this item
// //     const allOrders = await kv.getByPrefix('blanket-order:');
// //     const itemOrders = allOrders.filter((order: any) => order.itemId === itemId);
    
// //     const allReleases = await kv.getByPrefix('blanket-release:');
// //     const historicalData: number[] = [];
    
// //     // Aggregate monthly demand from releases
// //     const monthlyDemand: { [key: string]: number } = {};
    
// //     for (const release of allReleases) {
// //       const order = itemOrders.find((o: any) => o.id === release.blanketOrderId);
// //       if (order) {
// //         const month = release.releaseDate.substring(0, 7); // YYYY-MM
// //         monthlyDemand[month] = (monthlyDemand[month] || 0) + release.quantity;
// //       }
// //     }

// //     // Convert to array sorted by date
// //     const sortedMonths = Object.keys(monthlyDemand).sort();
// //     for (const month of sortedMonths) {
// //       historicalData.push(monthlyDemand[month]);
// //     }

// //     // Simple Holt-Winters implementation
// //     const forecast = simpleHoltWinters(historicalData, periods);

// //     // Store forecast
// //     const forecastId = `forecast:${itemId}:${Date.now()}`;
// //     const forecastRecord = {
// //       id: forecastId,
// //       itemId,
// //       historicalData,
// //       forecastData: forecast,
// //       periods,
// //       generatedAt: new Date().toISOString(),
// //       generatedBy: user.id
// //     };

// //     await kv.set(forecastId, forecastRecord);

// //     return c.json({ success: true, forecast: forecastRecord });
// //   } catch (error) {
// //     console.error('Error generating forecast:', error);
// //     return c.json({ error: 'Failed to generate forecast' }, 500);
// //   }
// // });

// // function simpleHoltWinters(data: number[], periods: number): number[] {
// //   if (data.length === 0) {
// //     return Array(periods).fill(0);
// //   }

// //   // Simple exponential smoothing with trend
// //   const alpha = 0.3; // Level smoothing
// //   const beta = 0.1;  // Trend smoothing

// //   let level = data[0];
// //   let trend = data.length > 1 ? (data[data.length - 1] - data[0]) / data.length : 0;

// //   // Smooth historical data
// //   for (let i = 1; i < data.length; i++) {
// //     const prevLevel = level;
// //     level = alpha * data[i] + (1 - alpha) * (level + trend);
// //     trend = beta * (level - prevLevel) + (1 - beta) * trend;
// //   }

// //   // Generate forecast
// //   const forecast: number[] = [];
// //   for (let i = 1; i <= periods; i++) {
// //     forecast.push(Math.max(0, Math.round(level + i * trend)));
// //   }

// //   return forecast;
// // }

// // app.get('/make-server-9c637d11/forecast/:itemId', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const itemId = c.req.param('itemId');
// //     const forecasts = await kv.getByPrefix(`forecast:${itemId}:`);
    
// //     // Get most recent forecast
// //     const sortedForecasts = forecasts.sort((a: any, b: any) => 
// //       new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
// //     );

// //     return c.json({ forecast: sortedForecasts[0] || null });
// //   } catch (error) {
// //     console.error('Error fetching forecast:', error);
// //     return c.json({ error: 'Failed to fetch forecast' }, 500);
// //   }
// // });

// // // ============================================================================
// // // PLANNING ENGINE
// // // ============================================================================

// // app.post('/make-server-9c637d11/planning/run', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const items = await kv.getByPrefix('item:');
// //     const inventory = await kv.getByPrefix('inventory:');
// //     const forecasts = await kv.getByPrefix('forecast:');

// //     const planningResults = [];

// //     for (const item of items) {
// //       if (item.status !== 'active') continue;

// //       const inv = inventory.find((i: any) => i.itemId === item.id);
// //       if (!inv) continue;

// //       // Get latest forecast
// //       const itemForecasts = forecasts.filter((f: any) => f.itemId === item.id);
// //       const latestForecast = itemForecasts.sort((a: any, b: any) => 
// //         new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
// //       )[0];

// //       const currentStock = inv.currentStock;
// //       const minStock = item.minStock;
// //       const maxStock = item.maxStock;
// //       const safetyStock = item.safetyStock;
// //       const leadTimeDays = item.leadTimeDays;

// //       // Calculate projected demand (next period from forecast)
// //       const projectedDemand = latestForecast?.forecastData[0] || 0;

// //       // Planning logic
// //       let status = 'healthy';
// //       let recommendedAction = 'No action required';
// //       let recommendedQuantity = 0;

// //       // Check if stock will fall below minimum after projected demand
// //       const projectedStock = currentStock - projectedDemand;

// //       if (projectedStock < minStock) {
// //         status = 'critical';
// //         recommendedQuantity = maxStock - projectedStock;
// //         recommendedAction = `Urgent: Plan production of ${recommendedQuantity} units immediately (Lead time: ${leadTimeDays} days)`;
// //       } else if (projectedStock < safetyStock) {
// //         status = 'warning';
// //         recommendedQuantity = maxStock - projectedStock;
// //         recommendedAction = `Warning: Plan production of ${recommendedQuantity} units within ${leadTimeDays} days`;
// //       } else if (currentStock > maxStock) {
// //         status = 'overstock';
// //         recommendedAction = `Overstock detected: ${currentStock - maxStock} units above maximum`;
// //       }

// //       const planningResult = {
// //         itemId: item.id,
// //         itemCode: item.itemCode,
// //         itemName: item.itemName,
// //         currentStock,
// //         minStock,
// //         maxStock,
// //         safetyStock,
// //         projectedDemand,
// //         projectedStock,
// //         status,
// //         recommendedAction,
// //         recommendedQuantity,
// //         leadTimeDays
// //       };

// //       planningResults.push(planningResult);

// //       // Store planning result
// //       const planId = `planning:${item.id}:${Date.now()}`;
// //       await kv.set(planId, {
// //         ...planningResult,
// //         id: planId,
// //         generatedAt: new Date().toISOString(),
// //         generatedBy: user.id
// //       });
// //     }

// //     return c.json({ success: true, results: planningResults });
// //   } catch (error) {
// //     console.error('Error running planning:', error);
// //     return c.json({ error: 'Failed to run planning' }, 500);
// //   }
// // });

// // app.get('/make-server-9c637d11/planning/latest', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const allPlanning = await kv.getByPrefix('planning:');
    
// //     // Get most recent planning for each item
// //     const latestPlanning: { [key: string]: any } = {};
    
// //     for (const plan of allPlanning) {
// //       const itemId = plan.itemId;
// //       if (!latestPlanning[itemId] || 
// //           new Date(plan.generatedAt) > new Date(latestPlanning[itemId].generatedAt)) {
// //         latestPlanning[itemId] = plan;
// //       }
// //     }

// //     return c.json({ results: Object.values(latestPlanning) });
// //   } catch (error) {
// //     console.error('Error fetching latest planning:', error);
// //     return c.json({ error: 'Failed to fetch planning' }, 500);
// //   }
// // });

// // // ============================================================================
// // // DASHBOARD & ANALYTICS
// // // ============================================================================

// // app.get('/make-server-9c637d11/dashboard', async (c) => {
// //   try {
// //     console.log('Dashboard endpoint: Received request');
// //     console.log('Dashboard endpoint: Authorization header:', c.req.header('Authorization') ? 'Present' : 'Missing');
    
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) {
// //       console.error('Dashboard endpoint: User validation failed, returning 401');
// //       return c.json({ error: 'Unauthorized' }, 401);
// //     }

// //     console.log('Dashboard endpoint: User validated, fetching data for user:', user.id);

// //     const items = await kv.getByPrefix('item:') || [];
// //     const inventory = await kv.getByPrefix('inventory:') || [];
// //     const planning = await kv.getByPrefix('planning:') || [];

// //     console.log(`Dashboard endpoint: Found ${items.length} items, ${inventory.length} inventory, ${planning.length} planning`);

// //     const activeItems = items.filter((i: any) => i?.status === 'active').length;
// //     const totalInventoryValue = inventory.reduce((sum: number, inv: any) => sum + (inv?.currentStock || 0), 0);

// //     // Get latest planning status counts
// //     const latestPlanning: { [key: string]: any } = {};
// //     for (const plan of planning) {
// //       if (!plan?.itemId) continue;
// //       const itemId = plan.itemId;
// //       if (!latestPlanning[itemId] || 
// //           new Date(plan.generatedAt) > new Date(latestPlanning[itemId].generatedAt)) {
// //         latestPlanning[itemId] = plan;
// //       }
// //     }

// //     const statusCounts = {
// //       healthy: 0,
// //       warning: 0,
// //       critical: 0,
// //       overstock: 0
// //     };

// //     for (const plan of Object.values(latestPlanning)) {
// //       const status = (plan as any)?.status;
// //       if (status && status in statusCounts) {
// //         statusCounts[status as keyof typeof statusCounts]++;
// //       }
// //     }

// //     const response = {
// //       activeItems,
// //       totalInventoryValue,
// //       statusCounts,
// //       lastUpdated: new Date().toISOString()
// //     };

// //     console.log('Dashboard endpoint: Returning data:', JSON.stringify(response));

// //     return c.json(response);
// //   } catch (error) {
// //     console.error('Dashboard endpoint: Error occurred:', error);
// //     // Return empty data instead of error
// //     return c.json({
// //       activeItems: 0,
// //       totalInventoryValue: 0,
// //       statusCounts: {
// //         healthy: 0,
// //         warning: 0,
// //         critical: 0,
// //         overstock: 0
// //       },
// //       lastUpdated: new Date().toISOString()
// //     });
// //   }
// // });

// // // ============================================================================
// // // HEALTH CHECK & DEBUG
// // // ============================================================================

// // app.get('/make-server-9c637d11/health', (c) => {
// //   return c.json({ status: 'ok', timestamp: new Date().toISOString() });
// // });

// // app.get('/make-server-9c637d11/debug/auth', async (c) => {
// //   const authHeader = c.req.header('Authorization');
// //   console.log('Debug auth endpoint: Authorization header:', authHeader);
  
// //   if (!authHeader) {
// //     return c.json({ 
// //       error: 'No authorization header',
// //       received: 'null'
// //     }, 400);
// //   }
  
// //   const token = authHeader.split(' ')[1];
// //   console.log('Debug auth endpoint: Token (first 20 chars):', token?.substring(0, 20));
  
// //   try {
// //     const { data, error } = await supabase.auth.getUser(token);
    
// //     if (error) {
// //       console.error('Debug auth endpoint: Validation error:', error);
// //       return c.json({
// //         error: 'Token validation failed',
// //         details: error.message,
// //         code: error.status || 401
// //       }, 401);
// //     }
    
// //     if (!data.user) {
// //       return c.json({
// //         error: 'No user in response',
// //         data
// //       }, 401);
// //     }
    
// //     return c.json({
// //       success: true,
// //       user: {
// //         id: data.user.id,
// //         email: data.user.email,
// //         created_at: data.user.created_at
// //       }
// //     });
// //   } catch (error) {
// //     console.error('Debug auth endpoint: Exception:', error);
// //     return c.json({
// //       error: 'Exception during validation',
// //       message: error instanceof Error ? error.message : String(error)
// //     }, 500);
// //   }
// // });

// // // ============================================================================
// // // SEED DATABASE WITH MOCK DATA
// // // ============================================================================

// // app.post('/make-server-9c637d11/seed-database', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     // Clear existing data first (optional - for demo purposes)
// //     const allKeys = [
// //       ...(await kv.getByPrefix('item:')),
// //       ...(await kv.getByPrefix('inventory:')),
// //       ...(await kv.getByPrefix('blanket-order:')),
// //       ...(await kv.getByPrefix('blanket-release:')),
// //       ...(await kv.getByPrefix('forecast:')),
// //       ...(await kv.getByPrefix('planning:'))
// //     ];

// //     // Create Items (Finished Goods)
// //     const items = [
// //       {
// //         id: 'item:fg-widget-a',
// //         itemCode: 'FG-WDG-001',
// //         itemName: 'Premium Widget Type A',
// //         uom: 'PCS',
// //         minStock: 500,
// //         maxStock: 2000,
// //         safetyStock: 750,
// //         leadTimeDays: 7,
// //         status: 'active',
// //         createdAt: new Date('2024-01-01').toISOString(),
// //         createdBy: user.id
// //       },
// //       {
// //         id: 'item:fg-widget-b',
// //         itemCode: 'FG-WDG-002',
// //         itemName: 'Standard Widget Type B',
// //         uom: 'PCS',
// //         minStock: 300,
// //         maxStock: 1500,
// //         safetyStock: 450,
// //         leadTimeDays: 5,
// //         status: 'active',
// //         createdAt: new Date('2024-01-01').toISOString(),
// //         createdBy: user.id
// //       },
// //       {
// //         id: 'item:fg-gear-x',
// //         itemCode: 'FG-GER-001',
// //         itemName: 'Industrial Gear Assembly X',
// //         uom: 'PCS',
// //         minStock: 200,
// //         maxStock: 800,
// //         safetyStock: 300,
// //         leadTimeDays: 10,
// //         status: 'active',
// //         createdAt: new Date('2024-01-01').toISOString(),
// //         createdBy: user.id
// //       },
// //       {
// //         id: 'item:fg-bearing',
// //         itemCode: 'FG-BRG-001',
// //         itemName: 'High-Performance Bearing Set',
// //         uom: 'PCS',
// //         minStock: 1000,
// //         maxStock: 5000,
// //         safetyStock: 1500,
// //         leadTimeDays: 3,
// //         status: 'active',
// //         createdAt: new Date('2024-01-01').toISOString(),
// //         createdBy: user.id
// //       },
// //       {
// //         id: 'item:fg-pump',
// //         itemCode: 'FG-PMP-001',
// //         itemName: 'Hydraulic Pump Unit',
// //         uom: 'PCS',
// //         minStock: 100,
// //         maxStock: 400,
// //         safetyStock: 150,
// //         leadTimeDays: 14,
// //         status: 'active',
// //         createdAt: new Date('2024-01-01').toISOString(),
// //         createdBy: user.id
// //       },
// //       {
// //         id: 'item:fg-valve',
// //         itemCode: 'FG-VLV-001',
// //         itemName: 'Pressure Control Valve',
// //         uom: 'PCS',
// //         minStock: 600,
// //         maxStock: 2500,
// //         safetyStock: 900,
// //         leadTimeDays: 6,
// //         status: 'active',
// //         createdAt: new Date('2024-01-01').toISOString(),
// //         createdBy: user.id
// //       }
// //     ];

// //     for (const item of items) {
// //       await kv.set(item.id, item);
// //     }

// //     // Create Inventory Records
// //     const inventory = [
// //       {
// //         id: 'inventory:item:fg-widget-a',
// //         itemId: 'item:fg-widget-a',
// //         openingStock: 1200,
// //         currentStock: 450, // Critical - below min!
// //         productionInward: 3500,
// //         customerOutward: 4250,
// //         lastUpdated: new Date().toISOString(),
// //         updatedBy: user.id
// //       },
// //       {
// //         id: 'inventory:item:fg-widget-b',
// //         itemId: 'item:fg-widget-b',
// //         openingStock: 800,
// //         currentStock: 920, // Healthy
// //         productionInward: 2100,
// //         customerOutward: 1980,
// //         lastUpdated: new Date().toISOString(),
// //         updatedBy: user.id
// //       },
// //       {
// //         id: 'inventory:item:fg-gear-x',
// //         itemId: 'item:fg-gear-x',
// //         openingStock: 500,
// //         currentStock: 280, // Warning - approaching min
// //         productionInward: 1200,
// //         customerOutward: 1420,
// //         lastUpdated: new Date().toISOString(),
// //         updatedBy: user.id
// //       },
// //       {
// //         id: 'inventory:item:fg-bearing',
// //         itemId: 'item:fg-bearing',
// //         openingStock: 3000,
// //         currentStock: 3200, // Healthy
// //         productionInward: 8000,
// //         customerOutward: 7800,
// //         lastUpdated: new Date().toISOString(),
// //         updatedBy: user.id
// //       },
// //       {
// //         id: 'inventory:item:fg-pump',
// //         itemId: 'item:fg-pump',
// //         openingStock: 250,
// //         currentStock: 85, // Critical!
// //         productionInward: 600,
// //         customerOutward: 765,
// //         lastUpdated: new Date().toISOString(),
// //         updatedBy: user.id
// //       },
// //       {
// //         id: 'inventory:item:fg-valve',
// //         itemId: 'item:fg-valve',
// //         openingStock: 1500,
// //         currentStock: 2800, // Overstock!
// //         productionInward: 4500,
// //         customerOutward: 3200,
// //         lastUpdated: new Date().toISOString(),
// //         updatedBy: user.id
// //       }
// //     ];

// //     for (const inv of inventory) {
// //       await kv.set(inv.id, inv);
// //     }

// //     // Create Blanket Orders
// //     const blanketOrders = [
// //       {
// //         id: 'blanket-order:bo-2024-001',
// //         orderNumber: 'BO-2024-001',
// //         customer: 'Acme Manufacturing Corp',
// //         itemId: 'item:fg-widget-a',
// //         totalQuantity: 12000,
// //         validFrom: '2024-01-01',
// //         validTo: '2024-12-31',
// //         status: 'active',
// //         createdAt: new Date('2024-01-01').toISOString(),
// //         createdBy: user.id
// //       },
// //       {
// //         id: 'blanket-order:bo-2024-002',
// //         orderNumber: 'BO-2024-002',
// //         customer: 'Global Tech Industries',
// //         itemId: 'item:fg-widget-b',
// //         totalQuantity: 8000,
// //         validFrom: '2024-01-01',
// //         validTo: '2024-12-31',
// //         status: 'active',
// //         createdAt: new Date('2024-01-05').toISOString(),
// //         createdBy: user.id
// //       },
// //       {
// //         id: 'blanket-order:bo-2024-003',
// //         orderNumber: 'BO-2024-003',
// //         customer: 'Precision Engineering Ltd',
// //         itemId: 'item:fg-gear-x',
// //         totalQuantity: 5000,
// //         validFrom: '2024-02-01',
// //         validTo: '2024-12-31',
// //         status: 'active',
// //         createdAt: new Date('2024-01-15').toISOString(),
// //         createdBy: user.id
// //       },
// //       {
// //         id: 'blanket-order:bo-2024-004',
// //         orderNumber: 'BO-2024-004',
// //         customer: 'Industrial Solutions Inc',
// //         itemId: 'item:fg-bearing',
// //         totalQuantity: 25000,
// //         validFrom: '2024-01-01',
// //         validTo: '2024-12-31',
// //         status: 'active',
// //         createdAt: new Date('2024-01-01').toISOString(),
// //         createdBy: user.id
// //       },
// //       {
// //         id: 'blanket-order:bo-2024-005',
// //         orderNumber: 'BO-2024-005',
// //         customer: 'Hydraulics International',
// //         itemId: 'item:fg-pump',
// //         totalQuantity: 2400,
// //         validFrom: '2024-03-01',
// //         validTo: '2024-12-31',
// //         status: 'active',
// //         createdAt: new Date('2024-02-15').toISOString(),
// //         createdBy: user.id
// //       }
// //     ];

// //     for (const order of blanketOrders) {
// //       await kv.set(order.id, order);
// //     }

// //     // Create Historical Blanket Releases (for forecasting)
// //     const releases = [];
// //     const now = new Date();
    
// //     // Widget A - 8 months of history with trend
// //     const widgetAMonthly = [850, 920, 880, 1050, 1100, 1150, 1200, 1250];
// //     for (let i = 0; i < 8; i++) {
// //       const releaseDate = new Date(now.getFullYear(), now.getMonth() - (8 - i), 1);
// //       releases.push({
// //         id: `blanket-release:blanket-order:bo-2024-001:rel-${i + 1}`,
// //         blanketOrderId: 'blanket-order:bo-2024-001',
// //         releaseNumber: `REL-2024-001-${String(i + 1).padStart(3, '0')}`,
// //         releaseDate: releaseDate.toISOString().split('T')[0],
// //         quantity: widgetAMonthly[i],
// //         deliveryDate: new Date(releaseDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
// //         status: 'fulfilled',
// //         createdAt: releaseDate.toISOString(),
// //         createdBy: user.id
// //       });
// //     }

// //     // Widget B - 6 months of history
// //     const widgetBMonthly = [600, 650, 720, 680, 750, 800];
// //     for (let i = 0; i < 6; i++) {
// //       const releaseDate = new Date(now.getFullYear(), now.getMonth() - (6 - i), 5);
// //       releases.push({
// //         id: `blanket-release:blanket-order:bo-2024-002:rel-${i + 1}`,
// //         blanketOrderId: 'blanket-order:bo-2024-002',
// //         releaseNumber: `REL-2024-002-${String(i + 1).padStart(3, '0')}`,
// //         releaseDate: releaseDate.toISOString().split('T')[0],
// //         quantity: widgetBMonthly[i],
// //         deliveryDate: new Date(releaseDate.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
// //         status: 'fulfilled',
// //         createdAt: releaseDate.toISOString(),
// //         createdBy: user.id
// //       });
// //     }

// //     // Gear X - 7 months of history
// //     const gearXMonthly = [400, 420, 450, 480, 500, 520, 550];
// //     for (let i = 0; i < 7; i++) {
// //       const releaseDate = new Date(now.getFullYear(), now.getMonth() - (7 - i), 10);
// //       releases.push({
// //         id: `blanket-release:blanket-order:bo-2024-003:rel-${i + 1}`,
// //         blanketOrderId: 'blanket-order:bo-2024-003',
// //         releaseNumber: `REL-2024-003-${String(i + 1).padStart(3, '0')}`,
// //         releaseDate: releaseDate.toISOString().split('T')[0],
// //         quantity: gearXMonthly[i],
// //         deliveryDate: new Date(releaseDate.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
// //         status: 'fulfilled',
// //         createdAt: releaseDate.toISOString(),
// //         createdBy: user.id
// //       });
// //     }

// //     // Bearing - 9 months of history
// //     const bearingMonthly = [2100, 2200, 2150, 2300, 2400, 2350, 2500, 2600, 2550];
// //     for (let i = 0; i < 9; i++) {
// //       const releaseDate = new Date(now.getFullYear(), now.getMonth() - (9 - i), 3);
// //       releases.push({
// //         id: `blanket-release:blanket-order:bo-2024-004:rel-${i + 1}`,
// //         blanketOrderId: 'blanket-order:bo-2024-004',
// //         releaseNumber: `REL-2024-004-${String(i + 1).padStart(3, '0')}`,
// //         releaseDate: releaseDate.toISOString().split('T')[0],
// //         quantity: bearingMonthly[i],
// //         deliveryDate: new Date(releaseDate.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
// //         status: 'fulfilled',
// //         createdAt: releaseDate.toISOString(),
// //         createdBy: user.id
// //       });
// //     }

// //     // Pump - 5 months of history (newer product)
// //     const pumpMonthly = [150, 165, 180, 195, 210];
// //     for (let i = 0; i < 5; i++) {
// //       const releaseDate = new Date(now.getFullYear(), now.getMonth() - (5 - i), 15);
// //       releases.push({
// //         id: `blanket-release:blanket-order:bo-2024-005:rel-${i + 1}`,
// //         blanketOrderId: 'blanket-order:bo-2024-005',
// //         releaseNumber: `REL-2024-005-${String(i + 1).padStart(3, '0')}`,
// //         releaseDate: releaseDate.toISOString().split('T')[0],
// //         quantity: pumpMonthly[i],
// //         deliveryDate: new Date(releaseDate.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
// //         status: 'fulfilled',
// //         createdAt: releaseDate.toISOString(),
// //         createdBy: user.id
// //       });
// //     }

// //     // Add some pending releases
// //     releases.push({
// //       id: `blanket-release:blanket-order:bo-2024-001:rel-pending-1`,
// //       blanketOrderId: 'blanket-order:bo-2024-001',
// //       releaseNumber: 'REL-2024-001-NEXT',
// //       releaseDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
// //       quantity: 1300,
// //       deliveryDate: new Date(now.getTime() + 12 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
// //       status: 'pending',
// //       createdAt: now.toISOString(),
// //       createdBy: user.id
// //     });

// //     for (const release of releases) {
// //       await kv.set(release.id, release);
// //     }

// //     return c.json({ 
// //       success: true, 
// //       message: 'Database seeded successfully',
// //       stats: {
// //         items: items.length,
// //         inventory: inventory.length,
// //         blanketOrders: blanketOrders.length,
// //         releases: releases.length
// //       }
// //     });
// //   } catch (error) {
// //     console.error('Error seeding database:', error);
// //     return c.json({ error: 'Failed to seed database' }, 500);
// //   }
// // });

// // // ============================================================================
// // // STOCK MOVEMENT ROUTES (Inventory Ledger)
// // // ============================================================================

// // // Create a new stock movement and update inventory
// // app.post('/make-server-9c637d11/stock-movements', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const body = await c.req.json();
// //     const { itemId, movementType, quantity, reason, referenceType, referenceId } = body;

// //     // Validate required fields
// //     if (!itemId || !movementType || !quantity) {
// //       return c.json({ error: 'Missing required fields: itemId, movementType, quantity' }, 400);
// //     }

// //     if (movementType !== 'IN' && movementType !== 'OUT') {
// //       return c.json({ error: 'movementType must be either IN or OUT' }, 400);
// //     }

// //     // Validate quantity is positive
// //     if (quantity <= 0) {
// //       return c.json({ error: 'Quantity must be greater than 0' }, 400);
// //     }

// //     // Validate FG item exists and is active
// //     const item = await kv.get(itemId);
// //     if (!item) {
// //       return c.json({ error: 'Item not found. Please create the FG item first.' }, 404);
// //     }

// //     if (item.status !== 'active') {
// //       return c.json({ error: 'Cannot perform stock movement on inactive item' }, 400);
// //     }

// //     // Validate reason is provided
// //     if (!reason || reason.trim() === '') {
// //       return c.json({ error: 'Reason is required for stock movement' }, 400);
// //     }

// //     // For OUT movements, validate additional requirements
// //     if (movementType === 'OUT') {
// //       if (reason === 'Blanket Release Shipment' && (!referenceId || referenceId.trim() === '')) {
// //         return c.json({ 
// //           error: 'Blanket Release ID is mandatory for Blanket Release Shipment' 
// //         }, 400);
// //       }
// //     }

// //     // Get current inventory
// //     const invId = `inventory:${itemId}`;
// //     let inventory = await kv.get(invId);

// //     // If inventory doesn't exist, create it with 0 stock
// //     if (!inventory) {
// //       inventory = {
// //         id: invId,
// //         itemId: itemId,
// //         openingStock: 0,
// //         currentStock: 0,
// //         productionInward: 0,
// //         customerOutward: 0,
// //         lastUpdated: new Date().toISOString(),
// //         updatedBy: user.id
// //       };
// //       await kv.set(invId, inventory);
// //       console.log(`Auto-created inventory record for item ${itemId} with 0 stock`);
// //     }

// //     // Calculate new stock level
// //     const previousStock = inventory.currentStock;
// //     let newStock = previousStock;

// //     if (movementType === 'IN') {
// //       newStock += quantity;
// //       inventory.productionInward += quantity;
// //     } else if (movementType === 'OUT') {
// //       newStock -= quantity;
// //       inventory.customerOutward += quantity;
// //     }

// //     // Prevent negative stock
// //     if (newStock < 0) {
// //       return c.json({ 
// //         error: 'Insufficient stock for OUT movement',
// //         details: `Cannot reduce stock by ${quantity} units. Current stock: ${previousStock} ${item.uom}. Shortfall: ${Math.abs(newStock)} ${item.uom}`
// //       }, 400);
// //     }

// //     // Warning if stock goes below minimum (allow but warn)
// //     let warning = null;
// //     if (newStock < item.minStock) {
// //       warning = `Warning: Stock level (${newStock}) is below minimum (${item.minStock})`;
// //     } else if (newStock > item.maxStock) {
// //       warning = `Warning: Stock level (${newStock}) exceeds maximum (${item.maxStock})`;
// //     }

// //     // Create stock movement record
// //     const movementId = `stock-movement:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
// //     const movement = {
// //       id: movementId,
// //       itemId,
// //       itemCode: item.itemCode,
// //       itemName: item.itemName,
// //       movementType,
// //       quantity,
// //       reason: reason.trim(),
// //       referenceType: referenceType || 'Manual',
// //       referenceId: referenceId || '',
// //       balanceAfter: newStock,
// //       previousBalance: previousStock,
// //       createdAt: new Date().toISOString(),
// //       createdBy: user.id,
// //       createdByName: user.user_metadata?.name || user.email
// //     };

// //     // Update inventory
// //     inventory.currentStock = newStock;
// //     inventory.lastUpdated = new Date().toISOString();
// //     inventory.updatedBy = user.id;

// //     // Save both records atomically
// //     await kv.set(movementId, movement);
// //     await kv.set(invId, inventory);

// //     console.log(`✅ Stock movement created: ${movementType} ${quantity} units for ${item.itemCode}. Previous: ${previousStock}, New: ${newStock}`);

// //     return c.json({ 
// //       success: true, 
// //       movement,
// //       updatedInventory: inventory,
// //       warning: warning
// //     });
// //   } catch (error) {
// //     console.error('Error creating stock movement:', error);
// //     return c.json({ error: 'Failed to create stock movement' }, 500);
// //   }
// // });

// // // Get all stock movements
// // app.get('/make-server-9c637d11/stock-movements', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const itemId = c.req.query('itemId');
    
// //     let movements;
// //     if (itemId) {
// //       // Get movements for specific item
// //       movements = await kv.getByPrefix('stock-movement:');
// //       movements = movements.filter((m: any) => m.itemId === itemId);
// //     } else {
// //       // Get all movements
// //       movements = await kv.getByPrefix('stock-movement:');
// //     }

// //     // Sort by date descending (newest first)
// //     movements.sort((a: any, b: any) => 
// //       new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
// //     );

// //     return c.json({ movements });
// //   } catch (error) {
// //     console.error('Error fetching stock movements:', error);
// //     return c.json({ error: 'Failed to fetch stock movements' }, 500);
// //   }
// // });

// // // Get stock movement history for an item (with balance progression)
// // app.get('/make-server-9c637d11/stock-movements/history/:itemId', async (c) => {
// //   try {
// //     const user = await getUserFromToken(c.req.header('Authorization'));
// //     if (!user) return c.json({ error: 'Unauthorized' }, 401);

// //     const itemId = c.req.param('itemId');

// //     // Get all movements for this item
// //     const allMovements = await kv.getByPrefix('stock-movement:');
// //     const itemMovements = allMovements.filter((m: any) => m.itemId === itemId);

// //     // Sort chronologically (oldest first for history view)
// //     itemMovements.sort((a: any, b: any) => 
// //       new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
// //     );

// //     // Get item details
// //     const item = await kv.get(itemId);
// //     const inventory = await kv.get(`inventory:${itemId}`);

// //     return c.json({ 
// //       movements: itemMovements,
// //       item,
// //       currentInventory: inventory
// //     });
// //   } catch (error) {
// //     console.error('Error fetching stock movement history:', error);
// //     return c.json({ error: 'Failed to fetch stock movement history' }, 500);
// //   }
// // });

// // // ============================================================================
// // // START SERVER
// // // ============================================================================

// // // Start server
// // Deno.serve(app.fetch);

// /**
//  * AUTOCAT ENGINEERS – ENTERPRISE ERP BACKEND
//  * Supabase Edge Function
//  * Production-grade (NO KV, NO MOCK DATA)
//  */

// import { Hono } from 'npm:hono';
// import { cors } from 'npm:hono/cors';
// import { logger } from 'npm:hono/logger';
// import { createClient } from 'jsr:@supabase/supabase-js@2';

// const app = new Hono();

// /* -------------------------------------------------------------------------- */
// /*                                   MIDDLEWARE                               */
// /* -------------------------------------------------------------------------- */

// app.use('*', cors());
// app.use('*', logger(console.log));

// /* -------------------------------------------------------------------------- */
// /*                             SUPABASE CLIENTS                               */
// /* -------------------------------------------------------------------------- */

// // Used ONLY to validate user sessions
// const supabaseAuth = createClient(
//   Deno.env.get('SUPABASE_URL')!,
//   Deno.env.get('SUPABASE_ANON_KEY')!
// );

// // Used for DB operations
// const supabaseAdmin = createClient(
//   Deno.env.get('SUPABASE_URL')!,
//   Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// );

// /* -------------------------------------------------------------------------- */
// /*                               AUTH MIDDLEWARE                              */
// /* -------------------------------------------------------------------------- */

// async function requireAuth(c: any, next: any) {
//   const authHeader = c.req.header('Authorization');

//   if (!authHeader || !authHeader.startsWith('Bearer ')) {
//     return c.json({ error: 'Unauthorized' }, 401);
//   }

//   const token = authHeader.replace('Bearer ', '');

//   const { data, error } = await supabaseAuth.auth.getUser(token);

//   if (error || !data?.user) {
//     return c.json({ error: 'Unauthorized' }, 401);
//   }

//   c.set('user', data.user);
//   await next();
// }

// /* -------------------------------------------------------------------------- */
// /*                                   DASHBOARD                                */
// /* -------------------------------------------------------------------------- */

// app.get('/make-server-9c637d11/dashboard', requireAuth, async (c) => {
//   try {
//     const [{ count: totalItems }, inventory, planning] = await Promise.all([
//       supabaseAdmin.from('items').select('*', { count: 'exact', head: true }),
//       supabaseAdmin.from('inventory').select('available_stock'),
//       supabaseAdmin.from('planning_recommendations').select('priority'),
//     ]);

//     const totalInventoryValue = inventory?.reduce(
//       (sum, i) => sum + (i.available_stock || 0),
//       0
//     ) ?? 0;

//     const statusCounts = {
//       CRITICAL: 0,
//       HIGH: 0,
//       MEDIUM: 0,
//       LOW: 0,
//     };

//     planning?.forEach((p) => {
//       if (p.priority in statusCounts) {
//         statusCounts[p.priority]++;
//       }
//     });

//     return c.json({
//       summary: {
//         totalItems: totalItems ?? 0,
//         totalInventoryValue,
//         planningStatus: statusCounts,
//       },
//       lastUpdated: new Date().toISOString(),
//     });
//   } catch (err) {
//     console.error(err);
//     return c.json({ error: 'Failed to load dashboard' }, 500);
//   }
// });

// /* -------------------------------------------------------------------------- */
// /*                                   ITEMS                                    */
// /* -------------------------------------------------------------------------- */

// app.get('/make-server-9c637d11/items', requireAuth, async () => {
//   const { data, error } = await supabaseAdmin
//     .from('items')
//     .select('*')
//     .order('created_at', { ascending: false });

//   if (error) throw error;
//   return Response.json({ items: data });
// });

// app.post('/make-server-9c637d11/items', requireAuth, async (c) => {
//   const user = c.get('user');
//   const body = await c.req.json();

//   const { data, error } = await supabaseAdmin
//     .from('items')
//     .insert({ ...body, created_by: user.id })
//     .select()
//     .single();

//   if (error) throw error;
//   return c.json({ success: true, item: data });
// });

// /* -------------------------------------------------------------------------- */
// /*                                 INVENTORY                                  */
// /* -------------------------------------------------------------------------- */

// app.get('/make-server-9c637d11/inventory', requireAuth, async () => {
//   const { data, error } = await supabaseAdmin
//     .from('inventory')
//     .select(`
//       *,
//       items (
//         item_name,
//         category,
//         uom,
//         min_stock_level,
//         safety_stock,
//         max_stock_level
//       )
//     `);

//   if (error) throw error;
//   return Response.json({ inventory: data });
// });

// /* -------------------------------------------------------------------------- */
// /*                              STOCK MOVEMENTS                               */
// /* -------------------------------------------------------------------------- */

// app.get('/make-server-9c637d11/stock-movements', requireAuth, async () => {
//   const { data, error } = await supabaseAdmin
//     .from('stock_movements')
//     .select('*')
//     .order('movement_date', { ascending: false });

//   if (error) throw error;
//   return Response.json({ movements: data });
// });

// /* -------------------------------------------------------------------------- */
// /*                              BLANKET ORDERS                                */
// /* -------------------------------------------------------------------------- */

// app.get('/make-server-9c637d11/blanket-orders', requireAuth, async () => {
//   const { data, error } = await supabaseAdmin
//     .from('blanket_orders')
//     .select(`
//       *,
//       blanket_order_lines (*)
//     `)
//     .order('created_at', { ascending: false });

//   if (error) throw error;
//   return Response.json({ orders: data });
// });

// app.post('/make-server-9c637d11/blanket-orders', requireAuth, async (c) => {
//   const user = c.get('user');
//   const body = await c.req.json();

//   const { data, error } = await supabaseAdmin
//     .from('blanket_orders')
//     .insert({ ...body, created_by: user.id })
//     .select()
//     .single();

//   if (error) throw error;
//   return c.json({ success: true, order: data });
// });

// /* -------------------------------------------------------------------------- */
// /*                             BLANKET RELEASES                               */
// /* -------------------------------------------------------------------------- */

// app.post('/make-server-9c637d11/blanket-releases', requireAuth, async (c) => {
//   const user = c.get('user');
//   const body = await c.req.json();

//   const { data, error } = await supabaseAdmin
//     .from('blanket_releases')
//     .insert({ ...body, created_by: user.id })
//     .select()
//     .single();

//   if (error) throw error;
//   return c.json({ success: true, release: data });
// });

// app.put('/make-server-9c637d11/blanket-releases/:id/status', requireAuth, async (c) => {
//   const id = c.req.param('id');
//   const body = await c.req.json();

//   const { data, error } = await supabaseAdmin
//     .from('blanket_releases')
//     .update({
//       status: body.status,
//       delivered_quantity: body.delivered_quantity,
//       actual_delivery_date: body.actual_delivery_date,
//     })
//     .eq('id', id)
//     .select()
//     .single();

//   if (error) throw error;
//   return c.json({ success: true, release: data });
// });

// /* -------------------------------------------------------------------------- */
// /*                                 HEALTH                                    */
// /* -------------------------------------------------------------------------- */

// app.get('/make-server-9c637d11/health', () => {
//   return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
// });

// /* -------------------------------------------------------------------------- */
// /*                                  EXPORT                                    */
// /* -------------------------------------------------------------------------- */

// export default app;


/**
 * Enterprise Inventory System - Main Server
 * Clean Architecture Implementation
 * 
 * Architecture:
 * Routes → Services → Repositories → KV Store
 */

import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as jose from 'npm:jose@4';

// Repositories
import { ItemRepository } from './repositories/ItemRepository.ts';
import { InventoryRepository } from './repositories/InventoryRepository.ts';
import { BlanketOrderRepository } from './repositories/BlanketOrderRepository.ts';

// Services
import { ItemService } from './services/ItemService.ts';
import { InventoryService } from './services/InventoryService.ts';
import { ForecastingService } from './services/ForecastingService.ts';
import { PlanningService } from './services/PlanningService.ts';
import { BlanketOrderService } from './services/BlanketOrderService.ts';
import { BlanketReleaseService } from './services/BlanketReleaseService.ts';

const app = new Hono();

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use('*', cors());
app.use('*', logger(console.log));

// ============================================================================
// SUPABASE CLIENTS
// ============================================================================

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!
);

// ============================================================================
// INITIALIZE SERVICES (Dependency Injection)
// ============================================================================

const itemRepo = new ItemRepository();
const inventoryRepo = new InventoryRepository();
const blanketOrderRepo = new BlanketOrderRepository();

const itemService = new ItemService(itemRepo, inventoryRepo);
const inventoryService = new InventoryService(inventoryRepo, itemRepo);
const blanketOrderService = new BlanketOrderService(blanketOrderRepo, itemRepo);
const forecastingService = new ForecastingService(blanketOrderRepo);
const planningService = new PlanningService(
  itemRepo,
  inventoryRepo,
  blanketOrderRepo,
  forecastingService
);
const blanketReleaseService = new BlanketReleaseService(
  blanketOrderRepo,
  inventoryService,
  itemRepo
);

// ============================================================================
// AUTH MIDDLEWARE WITH LOCAL JWT VERIFICATION
// ============================================================================

async function requireAuth(c: any, next: any) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader) {
    return c.json({ error: 'Unauthorized: No authorization header' }, 401);
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return c.json({ error: 'Unauthorized: Invalid authorization header' }, 401);
  }

  try {
    // Local JWT verification using jose
    const jwksUrl = new URL(`${Deno.env.get('SUPABASE_URL')}/auth/v1/.well-known/jwks.json`);
    const JWKS = jose.createRemoteJWKSet(jwksUrl);
    
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: `${Deno.env.get('SUPABASE_URL')}/auth/v1`,
      audience: 'authenticated',
    });

    if (!payload.sub) {
      return c.json({ error: 'Unauthorized: Invalid token payload' }, 401);
    }

    // Store user ID in context
    c.set('user', { id: payload.sub });
    await next();
    
  } catch (error) {
    console.error('Auth verification failed:', error);
    return c.json({ error: 'Unauthorized: Invalid JWT' }, 401);
  }
}

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

app.post('/make-server-9c637d11/auth/signup', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password, name } = body;

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      email_confirm: true
    });

    if (error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ success: true, user: data.user });
  } catch (error) {
    console.error('Signup error:', error);
    return c.json({ error: 'Signup failed' }, 500);
  }
});

// ============================================================================
// ITEM MASTER ROUTES
// ============================================================================

app.get('/make-server-9c637d11/items', requireAuth, async (c) => {
  try {
    const items = await itemService.getAllItems();
    return c.json({ items });
  } catch (error) {
    console.error('Error fetching items:', error);
    return c.json({ error: 'Failed to fetch items' }, 500);
  }
});

app.post('/make-server-9c637d11/items', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    const result = await itemService.createItem(body, user.id);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error('Error creating item:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Failed to create item' 
    }, 400);
  }
});

app.put('/make-server-9c637d11/items/:id', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const itemId = c.req.param('id');
    const body = await c.req.json();

    const item = await itemService.updateItem(itemId, body, user.id);
    return c.json({ success: true, item });
  } catch (error) {
    console.error('Error updating item:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Failed to update item' 
    }, 400);
  }
});

app.delete('/make-server-9c637d11/items/:id', requireAuth, async (c) => {
  try {
    const itemId = c.req.param('id');
    await itemService.deleteItem(itemId);
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting item:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete item' 
    }, 400);
  }
});

// ============================================================================
// INVENTORY ROUTES
// ============================================================================

app.get('/make-server-9c637d11/inventory', requireAuth, async (c) => {
  try {
    const inventory = await inventoryService.getAllInventory();
    return c.json({ inventory });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    return c.json({ error: 'Failed to fetch inventory' }, 500);
  }
});

app.post('/make-server-9c637d11/inventory/adjust', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    const result = await inventoryService.adjustStock(
      body.itemId,
      {
        movementType: body.movementType,
        transactionType: body.transactionType,
        quantity: body.quantity,
        reason: body.reason,
        notes: body.notes,
        referenceType: body.referenceType,
        referenceId: body.referenceId,
        referenceNumber: body.referenceNumber
      },
      user.id
    );

    return c.json({ success: true, ...result });
  } catch (error) {
    console.error('Error adjusting stock:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Failed to adjust stock' 
    }, 400);
  }
});

app.get('/make-server-9c637d11/stock-movements', requireAuth, async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '100');
    const movements = await inventoryService.getAllStockMovements(limit);
    return c.json({ movements });
  } catch (error) {
    console.error('Error fetching movements:', error);
    return c.json({ error: 'Failed to fetch stock movements' }, 500);
  }
});

// ============================================================================
// BLANKET ORDER ROUTES
// ============================================================================

app.get('/make-server-9c637d11/blanket-orders', requireAuth, async (c) => {
  try {
    const orders = await blanketOrderService.getAllOrders();
    return c.json({ orders });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return c.json({ error: 'Failed to fetch orders' }, 500);
  }
});

app.post('/make-server-9c637d11/blanket-orders', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    const result = await blanketOrderService.createOrder(body, user.id);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error('Error creating order:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Failed to create order' 
    }, 400);
  }
});

app.get('/make-server-9c637d11/blanket-orders/:id', requireAuth, async (c) => {
  try {
    const orderId = c.req.param('id');
    const result = await blanketOrderService.getOrderWithLines(orderId);
    
    if (!result) {
      return c.json({ error: 'Order not found' }, 404);
    }

    return c.json(result);
  } catch (error) {
    console.error('Error fetching order:', error);
    return c.json({ error: 'Failed to fetch order' }, 500);
  }
});

// ============================================================================
// BLANKET RELEASE ROUTES
// ============================================================================

app.get('/make-server-9c637d11/blanket-releases', requireAuth, async (c) => {
  try {
    const orderId = c.req.query('orderId');
    
    if (orderId) {
      const releases = await blanketReleaseService.getReleasesByOrderId(orderId);
      return c.json({ releases });
    }

    const releases = await blanketReleaseService.getAllReleases();
    return c.json({ releases });
  } catch (error) {
    console.error('Error fetching releases:', error);
    return c.json({ error: 'Failed to fetch releases' }, 500);
  }
});

app.post('/make-server-9c637d11/blanket-releases', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    const release = await blanketReleaseService.createRelease(body, user.id);
    return c.json({ success: true, release });
  } catch (error) {
    console.error('Error creating release:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Failed to create release' 
    }, 400);
  }
});

app.put('/make-server-9c637d11/blanket-releases/:id/status', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const releaseId = c.req.param('id');
    const body = await c.req.json();

    const release = await blanketReleaseService.updateReleaseStatus(
      releaseId,
      body.status,
      body.deliveredQuantity,
      body.actualDeliveryDate,
      user.id
    );

    return c.json({ success: true, release });
  } catch (error) {
    console.error('Error updating release:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Failed to update release' 
    }, 400);
  }
});

// ============================================================================
// FORECASTING ROUTES
// ============================================================================

app.post('/make-server-9c637d11/forecast/generate', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    const forecasts = await forecastingService.generateForecast(
      body.itemId,
      body.forecastMonths || 6,
      user.id
    );

    return c.json({ success: true, forecasts });
  } catch (error) {
    console.error('Error generating forecast:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Failed to generate forecast' 
    }, 400);
  }
});

app.get('/make-server-9c637d11/forecast/:itemId', requireAuth, async (c) => {
  try {
    const itemId = c.req.param('itemId');
    const forecasts = await forecastingService.getLatestForecast(itemId);
    
    return c.json({ forecasts });
  } catch (error) {
    console.error('Error fetching forecast:', error);
    return c.json({ error: 'Failed to fetch forecast' }, 500);
  }
});

// ============================================================================
// PLANNING ROUTES
// ============================================================================

app.post('/make-server-9c637d11/planning/run', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    const recommendations = await planningService.runMRP(
      body.planningHorizonDays || 90,
      user.id
    );

    return c.json({ success: true, recommendations });
  } catch (error) {
    console.error('Error running planning:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Failed to run planning' 
    }, 500);
  }
});

app.get('/make-server-9c637d11/planning/latest', requireAuth, async (c) => {
  try {
    const recommendations = await planningService.getLatestRecommendations();
    return c.json({ recommendations });
  } catch (error) {
    console.error('Error fetching planning:', error);
    return c.json({ error: 'Failed to fetch planning' }, 500);
  }
});

app.put('/make-server-9c637d11/planning/:id/approve', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');

    const recommendation = await planningService.approveRecommendation(id, user.id);
    return c.json({ success: true, recommendation });
  } catch (error) {
    console.error('Error approving recommendation:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Failed to approve recommendation' 
    }, 400);
  }
});

// ============================================================================
// DASHBOARD ROUTES
// ============================================================================

app.get('/make-server-9c637d11/dashboard', requireAuth, async (c) => {
  try {
    const items = await itemService.getActiveItems();
    const totalStockValue = await inventoryService.getTotalStockValue();
    const recommendations = await planningService.getLatestRecommendations();

    const statusCounts = {
      healthy: 0,
      warning: 0,
      critical: 0,
      overstock: 0
    };

    recommendations.forEach(r => {
      const status = r.priority === 'CRITICAL' ? 'critical' :
                     r.priority === 'HIGH' ? 'warning' :
                     r.priority === 'MEDIUM' ? 'warning' :
                     'healthy';
      if (status in statusCounts) {
        statusCounts[status as keyof typeof statusCounts]++;
      }
    });

    return c.json({
      activeItems: items.length,
      totalInventoryValue: totalStockValue,
      statusCounts,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return c.json({
      activeItems: 0,
      totalInventoryValue: 0,
      statusCounts: { healthy: 0, warning: 0, critical: 0, overstock: 0 },
      lastUpdated: new Date().toISOString()
    });
  }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/make-server-9c637d11/health', (c) => {
  return c.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    architecture: 'clean-layers',
    version: '2.0-enterprise'
  });
});

// ============================================================================
// START SERVER
// ============================================================================

Deno.serve(app.fetch);

console.log('🚀 Enterprise Inventory System Server Started');
console.log('📐 Architecture: Clean Architecture with Service Layer');
console.log('✅ Authentication: Local JWT Verification with Jose');
console.log('✅ Forecasting: Holt-Winters Triple Exponential Smoothing');
console.log('✅ Planning: MRP with Min/Max Logic');
console.log('✅ Auto-Updates: Blanket Release → Inventory Deduction');