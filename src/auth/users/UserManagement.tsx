import React, { useState, useEffect, useRef } from 'react';
import {
    Users,
    UserPlus,
    Search,
    RefreshCw,
    AlertCircle,
    CheckCircle,
    X,
    Loader2,
    Trash2,
    Key,
    Power,
    UserCheck,
    UserX,
    MoreVertical,
    Briefcase,
    Clock,
    User as UserIcon
} from 'lucide-react';
import {
    getAllUsers,
    createUser,
    updateUserRole,
    updateUserStatus,
    resetUserPassword,
    deleteUser,
    type UserListItem,
    type CreateUserRequest,
} from '../services/userService';
import { ROLE_CONFIG, type UserRole } from '../services/authService';
import { RoleBadge } from '../components/RoleBadge';

interface UserManagementProps {
    currentUserId: string;
}

export function UserManagement({ currentUserId }: UserManagementProps) {
    const [users, setUsers] = useState<UserListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    // Modal states
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    // Create user form state
    const [createForm, setCreateForm] = useState<CreateUserRequest>({
        email: '',
        password: '',
        full_name: '',
        role: 'L1',
        employee_id: '',
        department: '',
        shift: 'DAY',
    });
    const [createLoading, setCreateLoading] = useState(false);

    useEffect(() => {
        fetchUsers();
    }, []);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (activeDropdown && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setActiveDropdown(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activeDropdown]);

    const fetchUsers = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await getAllUsers();
            setUsers(data);
        } catch (err) {
            setError('Failed to fetch users');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreateLoading(true);
        setError(null);

        const result = await createUser(createForm, currentUserId);

        if (result.success) {
            setSuccess('User created successfully');
            setShowCreateModal(false);
            setCreateForm({
                email: '',
                password: '',
                full_name: '',
                role: 'L1',
                employee_id: '',
                department: '',
                shift: 'DAY'
            });
            fetchUsers();
        } else {
            setError(result.error || 'Failed to create user');
        }

        setCreateLoading(false);
    };

    const handleStatusChange = async (userId: string, isActive: boolean) => {
        const result = await updateUserStatus(userId, isActive);
        if (result.success) {
            setSuccess(isActive ? 'User activated' : 'User deactivated');
            fetchUsers();
            setActiveDropdown(null);
        } else {
            setError(result.error || 'Failed to update status');
        }
    };

    const handleResetPassword = async (user: UserListItem) => {
        const result = await resetUserPassword(user.id, ''); // Password ignored in email-based reset
        if (result.success) {
            setSuccess(result.error || 'Password reset email sent');
            setActiveDropdown(null);
        } else {
            setError(result.error || 'Failed to send reset email');
        }
    };

    const handleDeleteUser = async (user: UserListItem) => {
        if (!window.confirm(`Are you sure you want to delete ${user.full_name}?`)) return;

        const result = await deleteUser(user.id);
        if (result.success) {
            setSuccess('User deleted successfully');
            fetchUsers();
            setActiveDropdown(null);
        } else {
            setError(result.error || 'Failed to delete user');
        }
    };

    const filteredUsers = users.filter((user) => {
        const matchesSearch =
            user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (user.employee_id || '').toLowerCase().includes(searchTerm.toLowerCase());
        const matchesRole = roleFilter === 'all' || user.role === roleFilter;
        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'active' && user.is_active) ||
            (statusFilter === 'inactive' && !user.is_active);
        return matchesSearch && matchesRole && matchesStatus;
    });

    const stats = {
        total: users.length,
        active: users.filter(u => u.is_active).length,
        inactive: users.filter(u => !u.is_active).length,
        operators: users.filter(u => u.role === 'L1').length,
        supervisors: users.filter(u => u.role === 'L2').length,
    };

    // Auto-dismiss messages
    useEffect(() => {
        if (success) {
            const timer = setTimeout(() => setSuccess(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [success]);

    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    return (
        <div style={{ padding: '32px', backgroundColor: '#f9fafb', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
            {/* Page Title */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '30px', fontWeight: '800', color: '#111827', margin: 0 }}>User Management</h1>
                    <p style={{ color: '#6b7280', fontSize: '15px', marginTop: '4px' }}>Manage system users and enterprise permissions</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px 24px',
                        backgroundColor: '#2563eb',
                        color: 'white',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '15px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)',
                    }}
                >
                    <UserPlus size={19} />
                    Add New User
                </button>
            </div>

            {/* Alerts */}
            {success && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px', backgroundColor: '#dcfce7', color: '#15803d' }}>
                    <CheckCircle size={20} />
                    {success}
                </div>
            )}
            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px', backgroundColor: '#fef2f2', color: '#dc2626' }}>
                    <AlertCircle size={20} />
                    {error}
                </div>
            )}

            {/* Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '20px', marginBottom: '32px' }}>
                {[
                    { label: 'Total Users', value: stats.total, color: '#3b82f6', bg: '#eff6ff' },
                    { label: 'Active', value: stats.active, color: '#10b981', bg: '#ecfdf5' },
                    { label: 'Inactive', value: stats.inactive, color: '#ef4444', bg: '#fef2f2' },
                    { label: 'Operators', value: stats.operators, color: '#6366f1', bg: '#f5f3ff' },
                    { label: 'Supervisors', value: stats.supervisors, color: '#a855f7', bg: '#faf5ff' },
                ].map((stat, i) => (
                    <div key={i} style={{ backgroundColor: 'white', padding: '24px', borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', borderLeft: `6px solid ${stat.color}` }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#6b7280', marginBottom: '8px' }}>{stat.label}</div>
                        <div style={{ fontSize: '32px', fontWeight: '800', color: '#111827' }}>{stat.value}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', backgroundColor: 'white', padding: '16px', borderRadius: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                    <input
                        type="text"
                        placeholder="Search by name, ID, or email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{ width: '100%', padding: '12px 12px 12px 42px', border: '1px solid #e5e7eb', borderRadius: '10px', fontSize: '14px', boxSizing: 'border-box' }}
                    />
                </div>
                <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    style={{ padding: '0 16px', border: '1px solid #e5e7eb', borderRadius: '10px', fontSize: '14px', minWidth: '160px' }}
                >
                    <option value="all">All Roles</option>
                    <option value="L1">Operator</option>
                    <option value="L2">Supervisor</option>
                    <option value="L3">Manager</option>
                </select>
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{ padding: '0 16px', border: '1px solid #e5e7eb', borderRadius: '10px', fontSize: '14px', minWidth: '160px' }}
                >
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                </select>
                <button
                    onClick={fetchUsers}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '12px 16px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        backgroundColor: 'white',
                        cursor: 'pointer',
                    }}
                >
                    <RefreshCw size={16} />
                    Refresh
                </button>
            </div>

            {/* Table */}
            <div style={{ backgroundColor: 'white', borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: '60px', textAlign: 'center' }}>
                        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
                        <p style={{ marginTop: '16px', color: '#64748b' }}>Loading users...</p>
                    </div>
                ) : filteredUsers.length === 0 ? (
                    <div style={{ padding: '60px', textAlign: 'center' }}>
                        <Users size={48} style={{ color: '#cbd5e1' }} />
                        <p style={{ marginTop: '16px', color: '#64748b' }}>No users found</p>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                                {['Employee ID', 'Name', 'Email', 'Role', 'Department', 'Shift', 'Status', 'Actions'].map((h) => (
                                    <th key={h} style={{ padding: '18px 24px', textAlign: 'left', fontSize: '12px', fontWeight: '700', color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map((user) => (
                                <tr key={user.id} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: user.id === currentUserId ? '#f0f9ff' : 'transparent' }}>
                                    <td style={{ padding: '20px 24px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>{user.employee_id || '---'}</td>
                                    <td style={{ padding: '20px 24px' }}>
                                        <div style={{ fontWeight: '600', color: '#111827' }}>{user.full_name}</div>
                                        <div style={{ fontSize: '12px', color: '#9ca3af' }}>@{user.email.split('@')[0]}</div>
                                    </td>
                                    <td style={{ padding: '20px 24px', fontSize: '14px', color: '#4b5563' }}>{user.email}</td>
                                    <td style={{ padding: '20px 24px' }}>
                                        <RoleBadge role={user.role} />
                                    </td>
                                    <td style={{ padding: '20px 24px', fontSize: '14px', color: '#4b5563' }}>{user.department || 'Production'}</td>
                                    <td style={{ padding: '20px 24px', fontSize: '14px', color: '#4b5563' }}>{user.shift || 'DAY'}</td>
                                    <td style={{ padding: '20px 24px' }}>
                                        <span style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            padding: '4px 12px',
                                            borderRadius: '20px',
                                            fontSize: '12px',
                                            fontWeight: '600',
                                            backgroundColor: user.is_active ? '#ecfdf5' : '#fef2f2',
                                            color: user.is_active ? '#059669' : '#dc2626',
                                        }}>
                                            {user.is_active ? <UserCheck size={14} /> : <UserX size={14} />}
                                            {user.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '20px 24px', position: 'relative' }}>
                                        {user.id !== currentUserId && (
                                            <>
                                                <button
                                                    onClick={() => setActiveDropdown(activeDropdown === user.id ? null : user.id)}
                                                    style={{ padding: '8px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '8px', color: '#6b7280' }}
                                                >
                                                    <MoreVertical size={20} />
                                                </button>

                                                {activeDropdown === user.id && (
                                                    <div
                                                        ref={dropdownRef}
                                                        style={{
                                                            position: 'absolute',
                                                            right: '60px',
                                                            bottom: '0', // Positions menu above the row effectively
                                                            zIndex: 50,
                                                            width: '180px',
                                                            backgroundColor: 'white',
                                                            borderRadius: '12px',
                                                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                                                            border: '1px solid #e5e7eb',
                                                            overflow: 'hidden',
                                                        }}
                                                    >
                                                        <button onClick={() => {/* Edit logic */ }} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', textAlign: 'left', color: '#374151' }}>
                                                            <UserIcon size={16} /> Edit Details
                                                        </button>
                                                        <button onClick={() => handleStatusChange(user.id, !user.is_active)} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', textAlign: 'left', color: user.is_active ? '#f59e0b' : '#10b981' }}>
                                                            <Power size={16} /> {user.is_active ? 'Deactivate' : 'Activate'}
                                                        </button>
                                                        <button onClick={() => handleResetPassword(user)} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', textAlign: 'left', color: '#4b5563' }}>
                                                            <Key size={16} /> Reset Password
                                                        </button>
                                                        <div style={{ borderTop: '1px solid #f3f4f6' }}></div>
                                                        <button onClick={() => handleDeleteUser(user)} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', textAlign: 'left', color: '#ef4444' }}>
                                                            <Trash2 size={16} /> Delete User
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        {user.id === currentUserId && (
                                            <span style={{ color: '#94a3b8', fontSize: '12px' }}>You</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Create User Modal */}
            {showCreateModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div style={{ backgroundColor: 'white', padding: '32px', borderRadius: '20px', width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h2 style={{ fontSize: '24px', fontWeight: '800', margin: 0 }}>Add New Enterprise User</h2>
                            <button onClick={() => setShowCreateModal(false)} style={{ border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: '#6b7280' }}><X size={24} /></button>
                        </div>
                        <form onSubmit={handleCreateUser}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Full Name</label>
                                    <input type="text" required value={createForm.full_name} onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Employee ID</label>
                                    <input type="text" placeholder="EMP000" value={createForm.employee_id} onChange={(e) => setCreateForm({ ...createForm, employee_id: e.target.value })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }} />
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Email Address</label>
                                    <input type="email" required value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Password</label>
                                    <input type="password" required value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }} />
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Department</label>
                                    <select value={createForm.department} onChange={(e) => setCreateForm({ ...createForm, department: e.target.value })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }}>
                                        <option value="">Select Department</option>
                                        <option value="Cutting">Cutting</option>
                                        <option value="Production">Production</option>
                                        <option value="Quality">Quality</option>
                                        <option value="Dispatch">Dispatch</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Shift</label>
                                    <select value={createForm.shift} onChange={(e) => setCreateForm({ ...createForm, shift: e.target.value })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }}>
                                        <option value="DAY">Day Shift</option>
                                        <option value="NIGHT">Night Shift</option>
                                    </select>
                                </div>
                            </div>
                            <div style={{ marginBottom: '24px' }}>
                                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>System Role</label>
                                <select value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as UserRole })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }}>
                                    <option value="L1">Operator (L1)</option>
                                    <option value="L2">Supervisor (L2)</option>
                                    <option value="L3">Manager (L3)</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button type="button" onClick={() => setShowCreateModal(false)} style={{ flex: 1, padding: '14px', border: 'none', borderRadius: '12px', backgroundColor: '#f3f4f6', color: '#4b5563', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" disabled={createLoading} style={{ flex: 2, padding: '14px', border: 'none', borderRadius: '12px', backgroundColor: '#2563eb', color: 'white', fontWeight: '600', cursor: createLoading ? 'not-allowed' : 'pointer', opacity: createLoading ? 0.7 : 1 }}>
                                    {createLoading ? 'Creating...' : 'Create Enterprise User'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* CSS for spinner animation */}
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
