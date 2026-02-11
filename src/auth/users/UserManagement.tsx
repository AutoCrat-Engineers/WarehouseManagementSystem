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
    Power,
    UserCheck,
    UserX,
    MoreVertical,
    Edit,
    User as UserIcon,
    Download,
    XCircle,
    Shield,
    UserCog,
    Settings,
    ChevronDown
} from 'lucide-react';
import {
    getAllUsers,
    createUser,
    updateUser,
    updateUserStatus,
    deleteUser,
    type UserListItem,
    type CreateUserRequest,
    type UpdateUserRequest,
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

    // Pagination state - show 20 items at a time
    const [displayCount, setDisplayCount] = useState(20);
    const ITEMS_PER_PAGE = 20;

    // Modal states
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
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

    // Edit user form state
    const [editForm, setEditForm] = useState<UpdateUserRequest>({
        full_name: '',
        role: 'L1',
        employee_id: '',
        department: '',
        shift: '',
    });
    const [editLoading, setEditLoading] = useState(false);

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

    const handleEditUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUser) return;

        setEditLoading(true);
        setError(null);

        const result = await updateUser(selectedUser.id, editForm);

        if (result.success) {
            setSuccess('User updated successfully');
            setShowEditModal(false);
            setSelectedUser(null);
            fetchUsers();
        } else {
            setError(result.error || 'Failed to update user');
        }

        setEditLoading(false);
    };

    const openEditModal = (user: UserListItem) => {
        setSelectedUser(user);
        setEditForm({
            full_name: user.full_name,
            role: user.role,
            employee_id: user.employee_id || '',
            department: user.department || '',
            shift: user.shift || '',
        });
        setShowEditModal(true);
        setActiveDropdown(null);
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

    const openDeleteConfirm = (user: UserListItem) => {
        setSelectedUser(user);
        setShowDeleteConfirm(true);
        setActiveDropdown(null);
    };

    const handleDeleteUser = async () => {
        if (!selectedUser) return;

        const result = await deleteUser(selectedUser.id);
        if (result.success) {
            setSuccess('User deleted successfully');
            setShowDeleteConfirm(false);
            setSelectedUser(null);
            fetchUsers();
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

    // Paginated users - only show displayCount users
    const displayedUsers = filteredUsers.slice(0, displayCount);

    // Check if there are more users to load
    const hasMoreUsers = displayCount < filteredUsers.length;

    // Reset display count when filters change
    useEffect(() => {
        setDisplayCount(ITEMS_PER_PAGE);
    }, [searchTerm, roleFilter, statusFilter]);

    // Handle load more
    const handleLoadMore = () => {
        setDisplayCount(prev => prev + ITEMS_PER_PAGE);
    };

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Alerts */}
            {success && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', borderRadius: '10px', fontSize: '14px', backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>
                    <CheckCircle size={18} />
                    {success}
                </div>
            )}
            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', borderRadius: '10px', fontSize: '14px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }}>
                    <AlertCircle size={18} />
                    {error}
                </div>
            )}

            {/* Summary Cards - Responsive Grid with Click-to-Filter */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '14px',
            }}>
                {/* Total Users Card */}
                <div
                    onClick={() => { setRoleFilter('all'); setStatusFilter('all'); }}
                    style={{
                        backgroundColor: 'white',
                        padding: '20px',
                        borderRadius: '12px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        border: roleFilter === 'all' && statusFilter === 'all' ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                    }}
                >
                    <div style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <Users size={22} style={{ color: '#3b82f6' }} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280', marginBottom: '2px' }}>Total Users</div>
                        <div style={{ fontSize: '26px', fontWeight: '700', color: '#111827' }}>{stats.total}</div>
                    </div>
                </div>

                {/* Active Users Card */}
                <div
                    onClick={() => { setStatusFilter(statusFilter === 'active' ? 'all' : 'active'); setRoleFilter('all'); }}
                    style={{
                        backgroundColor: 'white',
                        padding: '20px',
                        borderRadius: '12px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        border: statusFilter === 'active' ? '2px solid #10b981' : '1px solid #e5e7eb',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                    }}
                >
                    <div style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <UserCheck size={22} style={{ color: '#10b981' }} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280', marginBottom: '2px' }}>Active</div>
                        <div style={{ fontSize: '26px', fontWeight: '700', color: '#111827' }}>{stats.active}</div>
                    </div>
                </div>

                {/* Inactive Users Card */}
                <div
                    onClick={() => { setStatusFilter(statusFilter === 'inactive' ? 'all' : 'inactive'); setRoleFilter('all'); }}
                    style={{
                        backgroundColor: 'white',
                        padding: '20px',
                        borderRadius: '12px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        border: statusFilter === 'inactive' ? '2px solid #ef4444' : '1px solid #e5e7eb',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                    }}
                >
                    <div style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <UserX size={22} style={{ color: '#ef4444' }} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280', marginBottom: '2px' }}>Inactive</div>
                        <div style={{ fontSize: '26px', fontWeight: '700', color: '#111827' }}>{stats.inactive}</div>
                    </div>
                </div>

                {/* Operators Card */}
                <div
                    onClick={() => { setRoleFilter(roleFilter === 'L1' ? 'all' : 'L1'); setStatusFilter('all'); }}
                    style={{
                        backgroundColor: 'white',
                        padding: '20px',
                        borderRadius: '12px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        border: roleFilter === 'L1' ? '2px solid #6366f1' : '1px solid #e5e7eb',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                    }}
                >
                    <div style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <UserCog size={22} style={{ color: '#6366f1' }} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280', marginBottom: '2px' }}>Operators</div>
                        <div style={{ fontSize: '26px', fontWeight: '700', color: '#111827' }}>{stats.operators}</div>
                    </div>
                </div>

                {/* Supervisors Card */}
                <div
                    onClick={() => { setRoleFilter(roleFilter === 'L2' ? 'all' : 'L2'); setStatusFilter('all'); }}
                    style={{
                        backgroundColor: 'white',
                        padding: '20px',
                        borderRadius: '12px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        border: roleFilter === 'L2' ? '2px solid #a855f7' : '1px solid #e5e7eb',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                    }}
                >
                    <div style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(168, 85, 247, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <Shield size={22} style={{ color: '#a855f7' }} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280', marginBottom: '2px' }}>Supervisors</div>
                        <div style={{ fontSize: '26px', fontWeight: '700', color: '#111827' }}>{stats.supervisors}</div>
                    </div>
                </div>
            </div>

            {/* Filter Bar - Search with Action Buttons */}
            <div style={{
                backgroundColor: 'white',
                padding: '16px 20px',
                borderRadius: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                border: '1px solid #e5e7eb',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
            }}>
                {/* Search Input with Clear X Button */}
                <div style={{ position: 'relative', flex: '1 1 350px', minWidth: '280px' }}>
                    <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                    <input
                        type="text"
                        placeholder="Search by name, employee ID, or email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '11px 40px 11px 42px',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                            fontSize: '14px',
                            boxSizing: 'border-box',
                            outline: 'none',
                            transition: 'border-color 0.2s',
                        }}
                    />
                    {/* Clear X Button inside search */}
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm('')}
                            style={{
                                position: 'absolute',
                                right: '10px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '50%',
                                color: '#9ca3af',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.color = '#6b7280'}
                            onMouseLeave={(e) => e.currentTarget.style.color = '#9ca3af'}
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>

                {/* Separator */}
                <div style={{ width: '1px', height: '28px', backgroundColor: '#e5e7eb' }} />

                {/* Clear All Filters Button - only shows when card filters are active */}
                {(roleFilter !== 'all' || statusFilter !== 'all') && (
                    <button
                        onClick={() => { setRoleFilter('all'); setStatusFilter('all'); }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '10px 14px',
                            border: '1px solid #fca5a5',
                            borderRadius: '8px',
                            backgroundColor: '#fef2f2',
                            color: '#dc2626',
                            fontSize: '13px',
                            fontWeight: '500',
                            cursor: 'pointer',
                        }}
                    >
                        <XCircle size={16} />
                        Clear Filters
                    </button>
                )}

                <button
                    onClick={fetchUsers}
                    disabled={loading}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '10px 14px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        backgroundColor: 'white',
                        color: '#374151',
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        opacity: loading ? 0.6 : 1,
                    }}
                >
                    <RefreshCw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                    Refresh
                </button>

                <button
                    onClick={() => {
                        const csv = filteredUsers.map(u =>
                            `${u.employee_id || ''},${u.full_name},${u.email},${u.role},${u.department || ''},${u.shift || ''},${u.is_active ? 'Active' : 'Inactive'}`
                        ).join('\n');
                        const header = 'Employee ID,Name,Email,Role,Department,Shift,Status\n';
                        const blob = new Blob([header + csv], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'users_export.csv';
                        a.click();
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '10px 14px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        backgroundColor: 'white',
                        color: '#374151',
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: 'pointer',
                    }}
                >
                    <Download size={16} />
                    Export CSV
                </button>

                <button
                    onClick={() => setShowCreateModal(true)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '10px 16px',
                        border: 'none',
                        borderRadius: '8px',
                        backgroundColor: '#2563eb',
                        color: 'white',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
                    }}
                >
                    <UserPlus size={16} />
                    Add User
                </button>
            </div>

            {/* Users Table Card */}
            <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                border: '1px solid #e5e7eb',
                overflow: 'hidden',
            }}>
                {loading ? (
                    <div style={{ padding: '80px', textAlign: 'center' }}>
                        <Loader2 size={36} style={{ animation: 'spin 1s linear infinite', color: '#3b82f6' }} />
                        <p style={{ marginTop: '16px', color: '#64748b', fontSize: '14px' }}>Loading users...</p>
                    </div>
                ) : filteredUsers.length === 0 ? (
                    <div style={{ padding: '80px', textAlign: 'center' }}>
                        <div style={{
                            width: '64px',
                            height: '64px',
                            borderRadius: '50%',
                            backgroundColor: '#f1f5f9',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 16px',
                        }}>
                            <Users size={32} style={{ color: '#94a3b8' }} />
                        </div>
                        <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                            {searchTerm || roleFilter !== 'all' || statusFilter !== 'all' ? 'No Matching Users' : 'No Users Found'}
                        </h3>
                        <p style={{ color: '#64748b', fontSize: '14px' }}>
                            {searchTerm || roleFilter !== 'all' || statusFilter !== 'all'
                                ? 'Try adjusting your search or filter criteria'
                                : 'Click "Add User" to create the first user'}
                        </p>
                    </div>
                ) : (
                    <>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                                        {['Employee ID', 'Name', 'Email', 'Role', 'Department', 'Shift', 'Status', 'Actions'].map((h) => (
                                            <th key={h} style={{
                                                padding: '14px 20px',
                                                textAlign: 'left',
                                                fontSize: '11px',
                                                fontWeight: '600',
                                                color: '#64748b',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em',
                                                whiteSpace: 'nowrap',
                                            }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayedUsers.map((user) => (
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
                                                    <div ref={activeDropdown === user.id ? dropdownRef : null} style={{ position: 'relative', display: 'inline-block' }}>
                                                        <button
                                                            onClick={() => setActiveDropdown(activeDropdown === user.id ? null : user.id)}
                                                            style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151' }}
                                                        >
                                                            <Settings size={16} />
                                                            Actions
                                                            <ChevronDown size={14} style={{ transform: activeDropdown === user.id ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
                                                        </button>
                                                        {activeDropdown === user.id && (
                                                            <div
                                                                style={{
                                                                    position: 'absolute',
                                                                    top: '100%',
                                                                    right: '0',
                                                                    marginTop: '4px',
                                                                    zIndex: 50,
                                                                    width: '180px',
                                                                    backgroundColor: 'white',
                                                                    borderRadius: '12px',
                                                                    boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                                                                    border: '1px solid #e5e7eb',
                                                                    overflow: 'hidden',
                                                                }}
                                                            >
                                                                <button
                                                                    onClick={() => openEditModal(user)}
                                                                    style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', textAlign: 'left', color: '#374151' }}
                                                                >
                                                                    <Edit size={16} /> Edit User
                                                                </button>
                                                                <div style={{ borderTop: '1px solid #f3f4f6' }}></div>
                                                                <button
                                                                    onClick={() => handleStatusChange(user.id, !user.is_active)}
                                                                    style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', textAlign: 'left', color: user.is_active ? '#f59e0b' : '#10b981' }}
                                                                >
                                                                    <Power size={16} /> {user.is_active ? 'Deactivate' : 'Activate'}
                                                                </button>
                                                                <div style={{ borderTop: '1px solid #f3f4f6' }}></div>
                                                                <button
                                                                    onClick={() => openDeleteConfirm(user)}
                                                                    style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', textAlign: 'left', color: '#ef4444' }}
                                                                >
                                                                    <Trash2 size={16} /> Delete User
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {user.id === currentUserId && (
                                                    <span style={{ color: '#94a3b8', fontSize: '12px' }}>You</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Load More Button - Outside scrollable area */}
                        {hasMoreUsers && (
                            <div style={{
                                padding: '20px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '12px',
                                borderTop: '1px solid #e5e7eb',
                                position: 'relative',
                                zIndex: 10,
                                backgroundColor: 'white',
                            }}>
                                <p style={{
                                    fontSize: '13px',
                                    color: '#64748b',
                                    margin: 0,
                                }}>
                                    Showing {displayedUsers.length} of {filteredUsers.length} users
                                </p>
                                <button
                                    onClick={handleLoadMore}
                                    className="load-more-btn"
                                >
                                    Load More ({Math.min(ITEMS_PER_PAGE, filteredUsers.length - displayedUsers.length)} more)
                                </button>
                            </div>
                        )}

                        {/* Show total when all loaded */}
                        {!hasMoreUsers && displayedUsers.length > 0 && (
                            <div style={{
                                padding: '16px',
                                textAlign: 'center',
                                borderTop: '1px solid #e5e7eb',
                            }}>
                                <p style={{
                                    fontSize: '13px',
                                    color: '#64748b',
                                }}>
                                    Showing all {filteredUsers.length} users
                                </p>
                            </div>
                        )}
                    </>
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

            {/* Edit User Modal */}
            {showEditModal && selectedUser && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div style={{ backgroundColor: 'white', padding: '32px', borderRadius: '20px', width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h2 style={{ fontSize: '24px', fontWeight: '800', margin: 0 }}>Edit User</h2>
                            <button onClick={() => { setShowEditModal(false); setSelectedUser(null); }} style={{ border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: '#6b7280' }}><X size={24} /></button>
                        </div>

                        {/* User Info Banner */}
                        <div style={{ backgroundColor: '#f0f9ff', padding: '16px', borderRadius: '12px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '20px', fontWeight: '700' }}>
                                {selectedUser.full_name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827' }}>{selectedUser.email}</div>
                                <div style={{ fontSize: '13px', color: '#6b7280' }}>User ID: {selectedUser.id.slice(0, 8)}...</div>
                            </div>
                        </div>

                        <form onSubmit={handleEditUser}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Full Name</label>
                                    <input type="text" required value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Employee ID</label>
                                    <input type="text" placeholder="EMP000" value={editForm.employee_id} onChange={(e) => setEditForm({ ...editForm, employee_id: e.target.value })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }} />
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Department</label>
                                    <select value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }}>
                                        <option value="">Select Department</option>
                                        <option value="Cutting">Cutting</option>
                                        <option value="Production">Production</option>
                                        <option value="Quality">Quality</option>
                                        <option value="Dispatch">Dispatch</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Shift</label>
                                    <select value={editForm.shift} onChange={(e) => setEditForm({ ...editForm, shift: e.target.value })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }}>
                                        <option value="DAY">Day Shift</option>
                                        <option value="NIGHT">Night Shift</option>
                                    </select>
                                </div>
                            </div>
                            <div style={{ marginBottom: '24px' }}>
                                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>System Role</label>
                                <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })} style={{ width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }}>
                                    <option value="L1">Operator (L1)</option>
                                    <option value="L2">Supervisor (L2)</option>
                                    <option value="L3">Manager (L3)</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button type="button" onClick={() => { setShowEditModal(false); setSelectedUser(null); }} style={{ flex: 1, padding: '14px', border: 'none', borderRadius: '12px', backgroundColor: '#f3f4f6', color: '#4b5563', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" disabled={editLoading} style={{ flex: 2, padding: '14px', border: 'none', borderRadius: '12px', backgroundColor: '#2563eb', color: 'white', fontWeight: '600', cursor: editLoading ? 'not-allowed' : 'pointer', opacity: editLoading ? 0.7 : 1 }}>
                                    {editLoading ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && selectedUser && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div style={{ backgroundColor: 'white', padding: '32px', borderRadius: '20px', width: '100%', maxWidth: '450px' }}>
                        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                            <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                                <Trash2 size={32} style={{ color: '#ef4444' }} />
                            </div>
                            <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#111827', margin: '0 0 8px' }}>Delete User</h3>
                            <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>
                                Are you sure you want to delete <strong>{selectedUser.full_name}</strong>? This action cannot be undone.
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button
                                onClick={() => { setShowDeleteConfirm(false); setSelectedUser(null); }}
                                style={{ flex: 1, padding: '14px', border: 'none', borderRadius: '12px', backgroundColor: '#f3f4f6', color: '#4b5563', fontWeight: '600', cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteUser}
                                style={{ flex: 1, padding: '14px', border: 'none', borderRadius: '12px', backgroundColor: '#ef4444', color: 'white', fontWeight: '600', cursor: 'pointer' }}
                            >
                                Delete User
                            </button>
                        </div>
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
