// import React, { useState, useEffect } from 'react';
// import { projectId } from '../utils/supabase/info';
// import { Plus, Edit2, Trash2, Search, Package, AlertCircle } from 'lucide-react';
// import { Card, Button, Badge, Input, Select, Label, Modal, LoadingSpinner, EmptyState } from './ui/EnterpriseUI';

// interface ItemMasterProps {
//   accessToken: string;
// }

// interface Item {
//   id: string;
//   itemCode: string;
//   itemName: string;
//   uom: string;
//   minStock: number;
//   maxStock: number;
//   safetyStock: number;
//   leadTimeDays: number;
//   status: 'active' | 'inactive';
//   createdAt: string;
// }

// export function ItemMaster({ accessToken }: ItemMasterProps) {
//   const [items, setItems] = useState<Item[]>([]);
//   const [loading, setLoading] = useState(true);
//   const [showModal, setShowModal] = useState(false);
//   const [editingItem, setEditingItem] = useState<Item | null>(null);
//   const [searchTerm, setSearchTerm] = useState('');
  
//   const [formData, setFormData] = useState({
//     itemCode: '',
//     itemName: '',
//     uom: 'PCS',
//     minStock: 0,
//     maxStock: 0,
//     safetyStock: 0,
//     leadTimeDays: 0,
//     status: 'active' as 'active' | 'inactive'
//   });

//   useEffect(() => {
//     fetchItems();
//   }, []);

//   const fetchItems = async () => {
//     try {
//       const response = await fetch(
//         `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/items`,
//         {
//           headers: {
//             'Authorization': `Bearer ${accessToken}`,
//           },
//         }
//       );

//       if (!response.ok) throw new Error('Failed to fetch items');
      
//       const data = await response.json();
//       setItems(data.items || []);
//     } catch (error) {
//       console.error('Error fetching items:', error);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault();
    
//     // Validate business rules
//     if (formData.minStock > formData.safetyStock) {
//       alert('Minimum stock cannot be greater than safety stock');
//       return;
//     }
//     if (formData.safetyStock > formData.maxStock) {
//       alert('Safety stock cannot be greater than maximum stock');
//       return;
//     }
    
//     try {
//       const url = editingItem
//         ? `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/items/${editingItem.id}`
//         : `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/items`;
      
//       const response = await fetch(url, {
//         method: editingItem ? 'PUT' : 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': `Bearer ${accessToken}`,
//         },
//         body: JSON.stringify(formData),
//       });

//       if (!response.ok) {
//         const error = await response.json();
//         throw new Error(error.error || 'Failed to save item');
//       }

//       await fetchItems();
//       handleCloseModal();
//     } catch (error) {
//       console.error('Error saving item:', error);
//       alert(error instanceof Error ? error.message : 'Failed to save item');
//     }
//   };

//   const handleDelete = async (id: string) => {
//     if (!confirm('Are you sure you want to delete this item?')) return;

//     try {
//       const response = await fetch(
//         `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/items/${id}`,
//         {
//           method: 'DELETE',
//           headers: {
//             'Authorization': `Bearer ${accessToken}`,
//           },
//         }
//       );

//       if (!response.ok) throw new Error('Failed to delete item');

//       await fetchItems();
//     } catch (error) {
//       console.error('Error deleting item:', error);
//       alert('Failed to delete item');
//     }
//   };

//   const handleEdit = (item: Item) => {
//     setEditingItem(item);
//     setFormData({
//       itemCode: item.itemCode,
//       itemName: item.itemName,
//       uom: item.uom,
//       minStock: item.minStock,
//       maxStock: item.maxStock,
//       safetyStock: item.safetyStock,
//       leadTimeDays: item.leadTimeDays,
//       status: item.status,
//     });
//     setShowModal(true);
//   };

//   const handleCloseModal = () => {
//     setShowModal(false);
//     setEditingItem(null);
//     setFormData({
//       itemCode: '',
//       itemName: '',
//       uom: 'PCS',
//       minStock: 0,
//       maxStock: 0,
//       safetyStock: 0,
//       leadTimeDays: 0,
//       status: 'active',
//     });
//   };

//   const filteredItems = items.filter(item =>
//     item.itemCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
//     item.itemName.toLowerCase().includes(searchTerm.toLowerCase())
//   );

//   if (loading) {
//     return <LoadingSpinner />;
//   }

//   return (
//     <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
//       {/* Header Actions */}
//       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
//         <div style={{ flex: 1, maxWidth: '400px', position: 'relative' }}>
//           <Search 
//             size={20} 
//             style={{
//               position: 'absolute',
//               left: '12px',
//               top: '50%',
//               transform: 'translateY(-50%)',
//               color: 'var(--enterprise-gray-400)',
//               pointerEvents: 'none',
//             }}
//           />
//           <Input
//             value={searchTerm}
//             onChange={(e) => setSearchTerm(e.target.value)}
//             placeholder="Search items by code or name..."
//             style={{ paddingLeft: '40px' }}
//           />
//         </div>
//         <Button variant="primary" icon={<Plus size={20} />} onClick={() => setShowModal(true)}>
//           Add Item
//         </Button>
//       </div>

//       {/* Summary Cards */}
//       <div style={{
//         display: 'grid',
//         gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
//         gap: '16px',
//       }}>
//         <Card>
//           <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
//             <div>
//               <p style={{
//                 fontSize: 'var(--font-size-sm)',
//                 color: 'var(--enterprise-gray-600)',
//                 fontWeight: 'var(--font-weight-medium)',
//                 marginBottom: '8px',
//               }}>
//                 Total Items
//               </p>
//               <p style={{
//                 fontSize: '2rem',
//                 fontWeight: 'var(--font-weight-bold)',
//                 color: 'var(--enterprise-primary)',
//               }}>
//                 {items.length}
//               </p>
//             </div>
//             <div style={{
//               width: '48px',
//               height: '48px',
//               borderRadius: 'var(--border-radius-md)',
//               backgroundColor: 'rgba(30, 58, 138, 0.1)',
//               display: 'flex',
//               alignItems: 'center',
//               justifyContent: 'center',
//             }}>
//               <Package size={24} style={{ color: 'var(--enterprise-primary)' }} />
//             </div>
//           </div>
//         </Card>

//         <Card>
//           <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
//             <div>
//               <p style={{
//                 fontSize: 'var(--font-size-sm)',
//                 color: 'var(--enterprise-gray-600)',
//                 fontWeight: 'var(--font-weight-medium)',
//                 marginBottom: '8px',
//               }}>
//                 Active Items
//               </p>
//               <p style={{
//                 fontSize: '2rem',
//                 fontWeight: 'var(--font-weight-bold)',
//                 color: 'var(--enterprise-success)',
//               }}>
//                 {items.filter(i => i.status === 'active').length}
//               </p>
//             </div>
//             <Badge variant="success">Active</Badge>
//           </div>
//         </Card>

//         <Card>
//           <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
//             <div>
//               <p style={{
//                 fontSize: 'var(--font-size-sm)',
//                 color: 'var(--enterprise-gray-600)',
//                 fontWeight: 'var(--font-weight-medium)',
//                 marginBottom: '8px',
//               }}>
//                 Inactive Items
//               </p>
//               <p style={{
//                 fontSize: '2rem',
//                 fontWeight: 'var(--font-weight-bold)',
//                 color: 'var(--enterprise-gray-500)',
//               }}>
//                 {items.filter(i => i.status === 'inactive').length}
//               </p>
//             </div>
//             <Badge variant="neutral">Inactive</Badge>
//           </div>
//         </Card>
//       </div>

//       {/* Business Rules Alert */}
//       <div style={{
//         backgroundColor: 'var(--enterprise-info-bg)',
//         border: '1px solid var(--enterprise-info)',
//         borderRadius: 'var(--border-radius-md)',
//         padding: '16px',
//         display: 'flex',
//         gap: '12px',
//       }}>
//         <AlertCircle size={20} style={{ color: 'var(--enterprise-info)', flexShrink: 0, marginTop: '2px' }} />
//         <div>
//           <p style={{
//             fontSize: 'var(--font-size-sm)',
//             fontWeight: 'var(--font-weight-semibold)',
//             color: 'var(--enterprise-info)',
//             marginBottom: '4px',
//           }}>
//             Business Rules
//           </p>
//           <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-700)' }}>
//             Min ≤ Safety ≤ Max stock levels • Creating an item automatically initializes inventory at 0 stock
//           </p>
//         </div>
//       </div>

//       {/* Items Table */}
//       <Card style={{ padding: 0, overflow: 'hidden' }}>
//         {filteredItems.length === 0 ? (
//           <EmptyState
//             icon={<Package size={48} />}
//             title="No Items Found"
//             description={searchTerm ? "Try adjusting your search" : "Create your first finished goods item"}
//             action={!searchTerm ? {
//               label: 'Add Item',
//               onClick: () => setShowModal(true)
//             } : undefined}
//           />
//         ) : (
//           <div style={{ overflowX: 'auto' }}>
//             <table style={{ width: '100%', borderCollapse: 'collapse' }}>
//               <thead>
//                 <tr style={{
//                   backgroundColor: 'var(--table-header-bg)',
//                   borderBottom: '2px solid var(--table-border)',
//                 }}>
//                   <th style={{
//                     padding: '12px 16px',
//                     textAlign: 'left',
//                     fontSize: 'var(--font-size-sm)',
//                     fontWeight: 'var(--font-weight-semibold)',
//                     color: 'var(--enterprise-gray-700)',
//                     textTransform: 'uppercase',
//                     letterSpacing: '0.5px',
//                   }}>
//                     Item Code
//                   </th>
//                   <th style={{
//                     padding: '12px 16px',
//                     textAlign: 'left',
//                     fontSize: 'var(--font-size-sm)',
//                     fontWeight: 'var(--font-weight-semibold)',
//                     color: 'var(--enterprise-gray-700)',
//                     textTransform: 'uppercase',
//                     letterSpacing: '0.5px',
//                   }}>
//                     Item Name
//                   </th>
//                   <th style={{
//                     padding: '12px 16px',
//                     textAlign: 'center',
//                     fontSize: 'var(--font-size-sm)',
//                     fontWeight: 'var(--font-weight-semibold)',
//                     color: 'var(--enterprise-gray-700)',
//                     textTransform: 'uppercase',
//                     letterSpacing: '0.5px',
//                   }}>
//                     UOM
//                   </th>
//                   <th style={{
//                     padding: '12px 16px',
//                     textAlign: 'right',
//                     fontSize: 'var(--font-size-sm)',
//                     fontWeight: 'var(--font-weight-semibold)',
//                     color: 'var(--enterprise-gray-700)',
//                     textTransform: 'uppercase',
//                     letterSpacing: '0.5px',
//                   }}>
//                     Min / Safety / Max
//                   </th>
//                   <th style={{
//                     padding: '12px 16px',
//                     textAlign: 'center',
//                     fontSize: 'var(--font-size-sm)',
//                     fontWeight: 'var(--font-weight-semibold)',
//                     color: 'var(--enterprise-gray-700)',
//                     textTransform: 'uppercase',
//                     letterSpacing: '0.5px',
//                   }}>
//                     Lead Time
//                   </th>
//                   <th style={{
//                     padding: '12px 16px',
//                     textAlign: 'center',
//                     fontSize: 'var(--font-size-sm)',
//                     fontWeight: 'var(--font-weight-semibold)',
//                     color: 'var(--enterprise-gray-700)',
//                     textTransform: 'uppercase',
//                     letterSpacing: '0.5px',
//                   }}>
//                     Status
//                   </th>
//                   <th style={{
//                     padding: '12px 16px',
//                     textAlign: 'center',
//                     fontSize: 'var(--font-size-sm)',
//                     fontWeight: 'var(--font-weight-semibold)',
//                     color: 'var(--enterprise-gray-700)',
//                     textTransform: 'uppercase',
//                     letterSpacing: '0.5px',
//                   }}>
//                     Actions
//                   </th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {filteredItems.map((item, index) => (
//                   <tr
//                     key={item.id}
//                     style={{
//                       backgroundColor: index % 2 === 0 ? 'white' : 'var(--table-stripe)',
//                       borderBottom: '1px solid var(--table-border)',
//                       transition: 'background-color var(--transition-fast)',
//                     }}
//                     onMouseEnter={(e) => {
//                       e.currentTarget.style.backgroundColor = 'var(--table-hover)';
//                     }}
//                     onMouseLeave={(e) => {
//                       e.currentTarget.style.backgroundColor = index % 2 === 0 ? 'white' : 'var(--table-stripe)';
//                     }}
//                   >
//                     <td style={{
//                       padding: '12px 16px',
//                       fontSize: 'var(--font-size-base)',
//                       fontWeight: 'var(--font-weight-semibold)',
//                       color: 'var(--enterprise-gray-900)',
//                     }}>
//                       {item.itemCode}
//                     </td>
//                     <td style={{
//                       padding: '12px 16px',
//                       fontSize: 'var(--font-size-base)',
//                       color: 'var(--enterprise-gray-800)',
//                     }}>
//                       {item.itemName}
//                     </td>
//                     <td style={{
//                       padding: '12px 16px',
//                       textAlign: 'center',
//                       fontSize: 'var(--font-size-sm)',
//                       color: 'var(--enterprise-gray-600)',
//                     }}>
//                       {item.uom}
//                     </td>
//                     <td style={{
//                       padding: '12px 16px',
//                       textAlign: 'right',
//                       fontSize: 'var(--font-size-base)',
//                       fontWeight: 'var(--font-weight-medium)',
//                       color: 'var(--enterprise-gray-800)',
//                     }}>
//                       {item.minStock} / {item.safetyStock} / {item.maxStock}
//                     </td>
//                     <td style={{
//                       padding: '12px 16px',
//                       textAlign: 'center',
//                       fontSize: 'var(--font-size-base)',
//                       color: 'var(--enterprise-gray-700)',
//                     }}>
//                       {item.leadTimeDays} days
//                     </td>
//                     <td style={{
//                       padding: '12px 16px',
//                       textAlign: 'center',
//                     }}>
//                       <Badge variant={item.status === 'active' ? 'success' : 'neutral'}>
//                         {item.status}
//                       </Badge>
//                     </td>
//                     <td style={{
//                       padding: '12px 16px',
//                       textAlign: 'center',
//                     }}>
//                       <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
//                         <Button
//                           variant="secondary"
//                           size="sm"
//                           icon={<Edit2 size={14} />}
//                           onClick={() => handleEdit(item)}
//                         >
//                           Edit
//                         </Button>
//                         <Button
//                           variant="danger"
//                           size="sm"
//                           icon={<Trash2 size={14} />}
//                           onClick={() => handleDelete(item.id)}
//                         >
//                           Delete
//                         </Button>
//                       </div>
//                     </td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           </div>
//         )}
//       </Card>

//       {/* Create/Edit Modal */}
//       <Modal
//         isOpen={showModal}
//         onClose={handleCloseModal}
//         title={editingItem ? 'Edit Item' : 'Create New Item'}
//         maxWidth="700px"
//       >
//         <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
//           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
//             <div>
//               <Label required>Item Code</Label>
//               <Input
//                 value={formData.itemCode}
//                 onChange={(e) => setFormData({ ...formData, itemCode: e.target.value })}
//                 placeholder="FG-001"
//                 required
//               />
//             </div>

//             <div>
//               <Label required>Unit of Measure</Label>
//               <Select
//                 value={formData.uom}
//                 onChange={(e) => setFormData({ ...formData, uom: e.target.value })}
//                 required
//               >
//                 <option value="PCS">Pieces (PCS)</option>
//                 <option value="KG">Kilograms (KG)</option>
//                 <option value="L">Liters (L)</option>
//                 <option value="M">Meters (M)</option>
//                 <option value="BOX">Box (BOX)</option>
//               </Select>
//             </div>
//           </div>

//           <div>
//             <Label required>Item Name</Label>
//             <Input
//               value={formData.itemName}
//               onChange={(e) => setFormData({ ...formData, itemName: e.target.value })}
//               placeholder="Enter item name..."
//               required
//             />
//           </div>

//           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
//             <div>
//               <Label required>Min Stock</Label>
//               <Input
//                 type="number"
//                 value={formData.minStock}
//                 onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
//                 min={0}
//                 required
//               />
//             </div>

//             <div>
//               <Label required>Safety Stock</Label>
//               <Input
//                 type="number"
//                 value={formData.safetyStock}
//                 onChange={(e) => setFormData({ ...formData, safetyStock: parseInt(e.target.value) || 0 })}
//                 min={0}
//                 required
//               />
//             </div>

//             <div>
//               <Label required>Max Stock</Label>
//               <Input
//                 type="number"
//                 value={formData.maxStock}
//                 onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value) || 0 })}
//                 min={0}
//                 required
//               />
//             </div>
//           </div>

//           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
//             <div>
//               <Label required>Lead Time (Days)</Label>
//               <Input
//                 type="number"
//                 value={formData.leadTimeDays}
//                 onChange={(e) => setFormData({ ...formData, leadTimeDays: parseInt(e.target.value) || 0 })}
//                 min={0}
//                 required
//               />
//             </div>

//             <div>
//               <Label>Status</Label>
//               <Select
//                 value={formData.status}
//                 onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
//               >
//                 <option value="active">Active</option>
//                 <option value="inactive">Inactive</option>
//               </Select>
//             </div>
//           </div>

//           <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
//             <Button type="submit" variant="primary" fullWidth>
//               {editingItem ? 'Update Item' : 'Create Item'}
//             </Button>
//             <Button type="button" variant="tertiary" fullWidth onClick={handleCloseModal}>
//               Cancel
//             </Button>
//           </div>
//         </form>
//       </Modal>
//     </div>
//   );
// }


import React, { useState, useEffect } from 'react';
import { projectId } from '../utils/supabase/info';
import { fetchWithAuth } from '../utils/supabase/auth';
import { Plus, Edit2, Trash2, Search, Package, AlertCircle } from 'lucide-react';
import { Card, Button, Badge, Input, Select, Label, Modal, LoadingSpinner, EmptyState } from './ui/EnterpriseUI';

interface ItemMasterProps {
  accessToken: string | null;
}

interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  uom: string;
  minStock: number;
  maxStock: number;
  safetyStock: number;
  leadTimeDays: number;
  status: 'active' | 'inactive';
  createdAt: string;
}

/** Map API response (snake_case) to frontend Item (camelCase) */
function mapApiItemToItem(raw: Record<string, unknown>): Item {
  return {
    id: String(raw.id ?? raw.item_id ?? ''),
    itemCode: String(raw.item_code ?? raw.itemCode ?? ''),
    itemName: String(raw.item_name ?? raw.itemName ?? ''),
    uom: String(raw.unit_of_measure ?? raw.uom ?? 'PCS'),
    minStock: Number(raw.min_stock ?? raw.min_stock_level ?? raw.minStock ?? 0),
    maxStock: Number(raw.max_stock ?? raw.max_stock_level ?? raw.maxStock ?? 0),
    safetyStock: Number(raw.safety_stock ?? raw.safetyStock ?? 0),
    leadTimeDays: Number(raw.lead_time_days ?? raw.leadTimeDays ?? 0),
    status: (raw.status === 'inactive' || raw.status === 'INACTIVE' ? 'inactive' : 'active') as 'active' | 'inactive',
    createdAt: String(raw.created_at ?? raw.createdAt ?? ''),
  };
}

/** Convert form data to API payload (snake_case). Sends both schema names and backend validation names for compatibility. */
function formDataToApiPayload(formData: typeof formDataDefault): Record<string, unknown> {
  return {
    item_code: formData.itemCode,
    item_name: formData.itemName,
    unit_of_measure: formData.uom,
    min_stock: formData.minStock,
    max_stock: formData.maxStock,
    safety_stock: formData.safetyStock,
    min_stock_level: formData.minStock,
    max_stock_level: formData.maxStock,
    lead_time_days: formData.leadTimeDays,
    status: formData.status,
  };
}

const formDataDefault = {
  itemCode: '',
  itemName: '',
  uom: 'PCS',
  minStock: 0,
  maxStock: 0,
  safetyStock: 0,
  leadTimeDays: 0,
  status: 'active' as 'active' | 'inactive',
};

export function ItemMaster({ accessToken }: ItemMasterProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [formData, setFormData] = useState(formDataDefault);

  useEffect(() => {
    if (accessToken) {
      fetchItems();
    } else {
      setError('No authentication token available');
      setLoading(false);
    }
  }, [accessToken]);

  const fetchItems = async () => {
    try {
      setError(null);
      setLoading(true);

      const response = await fetchWithAuth(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/items`
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `HTTP ${response.status}: Failed to fetch items`
        );
      }
      
      const data = await response.json();
      const rawItems = Array.isArray(data.items) ? data.items : [];
      setItems(rawItems.map((raw: Record<string, unknown>) => mapApiItemToItem(raw)));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('Error fetching items:', err);
      setError(errorMsg);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    // Validate business rules
    if (formData.minStock > formData.safetyStock) {
      setError('Minimum stock cannot be greater than safety stock');
      return;
    }
    if (formData.safetyStock > formData.maxStock) {
      setError('Safety stock cannot be greater than maximum stock');
      return;
    }
    
    try {
      const url = editingItem
        ? `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/items/${editingItem.id}`
        : `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/items`;
      
      const response = await fetchWithAuth(url, {
        method: editingItem ? 'PUT' : 'POST',
        body: JSON.stringify(formDataToApiPayload(formData)),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to save item`);
      }

      await fetchItems();
      handleCloseModal();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to save item';
      console.error('Error saving item:', err);
      setError(errorMsg);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      setError(null);
      const response = await fetchWithAuth(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/items/${id}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to delete item`);
      }

      await fetchItems();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete item';
      console.error('Error deleting item:', err);
      setError(errorMsg);
    }
  };

  const handleEdit = (item: Item) => {
    setEditingItem(item);
    setFormData({
      itemCode: item.itemCode,
      itemName: item.itemName,
      uom: item.uom,
      minStock: item.minStock,
      maxStock: item.maxStock,
      safetyStock: item.safetyStock,
      leadTimeDays: item.leadTimeDays,
      status: item.status,
    });
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({ ...formDataDefault });
    setError(null);
  };

  const filteredItems = items.filter(item =>
    item.itemCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.itemName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Error Alert */}
      {error && (
        <div style={{
          padding: '16px',
          backgroundColor: '#fee2e2',
          borderRadius: 'var(--border-radius-md)',
          color: '#dc2626',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
        }}>
          <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>{error}</div>
        </div>
      )}

      {/* Header Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
        <div style={{ flex: 1, maxWidth: '400px', position: 'relative' }}>
          <Search 
            size={20} 
            style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--enterprise-gray-400)',
              pointerEvents: 'none',
            }}
          />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search items by code or name..."
            style={{ paddingLeft: '40px' }}
          />
        </div>
        <Button variant="primary" icon={<Plus size={20} />} onClick={() => setShowModal(true)}>
          Add Item
        </Button>
      </div>

      {/* Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '16px',
      }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--enterprise-gray-600)',
                fontWeight: 'var(--font-weight-medium)',
                marginBottom: '8px',
              }}>
                Total Items
              </p>
              <p style={{
                fontSize: '2rem',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--enterprise-primary)',
              }}>
                {items.length}
              </p>
            </div>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--border-radius-md)',
              backgroundColor: 'rgba(30, 58, 138, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Package size={24} style={{ color: 'var(--enterprise-primary)' }} />
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--enterprise-gray-600)',
                fontWeight: 'var(--font-weight-medium)',
                marginBottom: '8px',
              }}>
                Active Items
              </p>
              <p style={{
                fontSize: '2rem',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--enterprise-success)',
              }}>
                {items.filter(i => i.status === 'active').length}
              </p>
            </div>
            <Badge variant="success">Active</Badge>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--enterprise-gray-600)',
                fontWeight: 'var(--font-weight-medium)',
                marginBottom: '8px',
              }}>
                Inactive Items
              </p>
              <p style={{
                fontSize: '2rem',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--enterprise-gray-500)',
              }}>
                {items.filter(i => i.status === 'inactive').length}
              </p>
            </div>
            <Badge variant="neutral">Inactive</Badge>
          </div>
        </Card>
      </div>

      {/* Business Rules Alert */}
      <div style={{
        backgroundColor: 'var(--enterprise-info-bg)',
        border: '1px solid var(--enterprise-info)',
        borderRadius: 'var(--border-radius-md)',
        padding: '16px',
        display: 'flex',
        gap: '12px',
      }}>
        <AlertCircle size={20} style={{ color: 'var(--enterprise-info)', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <p style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--enterprise-info)',
            marginBottom: '4px',
          }}>
            Business Rules
          </p>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-700)' }}>
            Min ≤ Safety ≤ Max stock levels • Creating an item automatically initializes inventory at 0 stock
          </p>
        </div>
      </div>

      {/* Items Table */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {filteredItems.length === 0 ? (
          <EmptyState
            icon={<Package size={48} />}
            title="No Items Found"
            description={searchTerm ? "Try adjusting your search" : "Create your first finished goods item"}
            action={!searchTerm ? {
              label: 'Add Item',
              onClick: () => setShowModal(true)
            } : undefined}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{
                  backgroundColor: 'var(--table-header-bg)',
                  borderBottom: '2px solid var(--table-border)',
                }}>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Item Code
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Item Name
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'center',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    UOM
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Min / Safety / Max
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'center',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Lead Time
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'center',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Status
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'center',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, index) => (
                  <tr
                    key={item.id}
                    style={{
                      backgroundColor: index % 2 === 0 ? 'white' : 'var(--table-stripe)',
                      borderBottom: '1px solid var(--table-border)',
                      transition: 'background-color var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--table-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = index % 2 === 0 ? 'white' : 'var(--table-stripe)';
                    }}
                  >
                    <td style={{
                      padding: '12px 16px',
                      fontSize: 'var(--font-size-base)',
                      fontWeight: 'var(--font-weight-semibold)',
                      color: 'var(--enterprise-gray-900)',
                    }}>
                      {item.itemCode}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      fontSize: 'var(--font-size-base)',
                      color: 'var(--enterprise-gray-800)',
                    }}>
                      {item.itemName}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'center',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--enterprise-gray-600)',
                    }}>
                      {item.uom}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontSize: 'var(--font-size-base)',
                      fontWeight: 'var(--font-weight-medium)',
                      color: 'var(--enterprise-gray-800)',
                    }}>
                      {item.minStock} / {item.safetyStock} / {item.maxStock}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'center',
                      fontSize: 'var(--font-size-base)',
                      color: 'var(--enterprise-gray-700)',
                    }}>
                      {item.leadTimeDays} days
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'center',
                    }}>
                      <Badge variant={item.status === 'active' ? 'success' : 'neutral'}>
                        {item.status}
                      </Badge>
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'center',
                    }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Edit2 size={14} />}
                          onClick={() => handleEdit(item)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={<Trash2 size={14} />}
                          onClick={() => handleDelete(item.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={handleCloseModal}
        title={editingItem ? 'Edit Item' : 'Create New Item'}
        maxWidth="700px"
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <Label required>Item Code</Label>
              <Input
                value={formData.itemCode}
                onChange={(e) => setFormData({ ...formData, itemCode: e.target.value })}
                placeholder="FG-001"
                required
              />
            </div>

            <div>
              <Label required>Unit of Measure</Label>
              <Select
                value={formData.uom}
                onChange={(e) => setFormData({ ...formData, uom: e.target.value })}
                required
              >
                <option value="PCS">Pieces (PCS)</option>
                <option value="KG">Kilograms (KG)</option>
                <option value="L">Liters (L)</option>
                <option value="M">Meters (M)</option>
                <option value="BOX">Box (BOX)</option>
              </Select>
            </div>
          </div>

          <div>
            <Label required>Item Name</Label>
            <Input
              value={formData.itemName}
              onChange={(e) => setFormData({ ...formData, itemName: e.target.value })}
              placeholder="Enter item name..."
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div>
              <Label required>Min Stock</Label>
              <Input
                type="number"
                value={formData.minStock}
                onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                min={0}
                required
              />
            </div>

            <div>
              <Label required>Safety Stock</Label>
              <Input
                type="number"
                value={formData.safetyStock}
                onChange={(e) => setFormData({ ...formData, safetyStock: parseInt(e.target.value) || 0 })}
                min={0}
                required
              />
            </div>

            <div>
              <Label required>Max Stock</Label>
              <Input
                type="number"
                value={formData.maxStock}
                onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value) || 0 })}
                min={0}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <Label required>Lead Time (Days)</Label>
              <Input
                type="number"
                value={formData.leadTimeDays}
                onChange={(e) => setFormData({ ...formData, leadTimeDays: parseInt(e.target.value) || 0 })}
                min={0}
                required
              />
            </div>

            <div>
              <Label>Status</Label>
              <Select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <Button type="submit" variant="primary" fullWidth>
              {editingItem ? 'Update Item' : 'Create Item'}
            </Button>
            <Button type="button" variant="tertiary" fullWidth onClick={handleCloseModal}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
} 
