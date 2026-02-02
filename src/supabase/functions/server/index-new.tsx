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
// AUTH MIDDLEWARE
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
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('Auth error:', error);
      return c.json({ error: 'Unauthorized: Invalid token' }, 401);
    }

    // Store user in context
    c.set('user', user);
    await next();
    
  } catch (error) {
    console.error('Auth exception:', error);
    return c.json({ error: 'Unauthorized: Auth validation failed' }, 401);
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
console.log('✅ Authentication: Supabase Standard');
console.log('✅ Forecasting: Holt-Winters Triple Exponential Smoothing');
console.log('✅ Planning: MRP with Min/Max Logic');
console.log('✅ Auto-Updates: Blanket Release → Inventory Deduction');
