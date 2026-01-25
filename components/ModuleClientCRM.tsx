
import React, { useState, useEffect } from 'react';
import { Client } from '../types';
import { exportClientsToExcel } from '../services/exportService';
import { 
    Users, Filter, Package, Plus, Search, Calendar, 
    Clock, AlertCircle, Save, Edit3, Trash2, X, ShieldCheck, CheckSquare, Square, PlayCircle, Globe, ShoppingBag, Download
} from 'lucide-react';

interface Props {
    clients: Client[];
    setClients: React.Dispatch<React.SetStateAction<Client[]>>;
    onBatchAnalyze?: (clients: Client[]) => void;
}

export const ModuleClientCRM: React.FC<Props> = ({ clients, setClients, onBatchAnalyze }) => {
    // --- State ---
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);

    // Filters
    const [filterName, setFilterName] = useState('');
    const [filterCountry, setFilterCountry] = useState('');
    const [filterProduct, setFilterProduct] = useState('');
    const [filterStatus, setFilterStatus] = useState('All');
    const [filterAnalyzed, setFilterAnalyzed] = useState('All'); // All, Yes, No

    // --- CRUD ---
    const handleDelete = (id: string) => {
        if (window.confirm('确认删除该客户吗? (Are you sure you want to delete this client?)')) {
            setClients(prev => prev.filter(c => c.id !== id));
            setSelectedIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(id);
                return newSet;
            });
        }
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        const formData = new FormData(e.target as HTMLFormElement);
        
        const newClient: Client = {
            id: editingClient ? editingClient.id : Date.now().toString(),
            name: formData.get('name') as string,
            website: formData.get('website') as string,
            country: formData.get('country') as string,
            type: formData.get('type') as any,
            status: formData.get('status') as any,
            productType: formData.get('productType') as string,
            priceRange: formData.get('priceRange') as string,
            isSampleNeeded: formData.get('isSampleNeeded') === 'on',
            hasAnalyzed: editingClient ? editingClient.hasAnalyzed : false, // Preserve or default
            lastOrderDate: formData.get('lastOrderDate') as string,
            lastContactSent: formData.get('lastContactSent') as string,
            lastContactReceived: formData.get('lastContactReceived') as string,
            nextFollowUpDate: formData.get('nextFollowUpDate') as string,
            activityLog: formData.get('activityLog') as string,
        };

        if (editingClient) {
            setClients(prev => prev.map(c => c.id === newClient.id ? newClient : c));
        } else {
            setClients(prev => [newClient, ...prev]);
        }
        setIsModalOpen(false);
        setEditingClient(null);
    };

    const openEdit = (client: Client) => {
        setEditingClient(client);
        setIsModalOpen(true);
    };

    const openNew = () => {
        setEditingClient(null);
        setIsModalOpen(true);
    };

    // --- Selection Logic ---
    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const toggleSelectAll = (filteredList: Client[]) => {
        const allSelected = filteredList.length > 0 && filteredList.every(c => selectedIds.has(c.id));
        const newSet = new Set(selectedIds);
        
        if (allSelected) {
            filteredList.forEach(c => newSet.delete(c.id));
        } else {
            filteredList.forEach(c => newSet.add(c.id));
        }
        setSelectedIds(newSet);
    };

    const runBatchAnalysis = () => {
        const selectedClients = clients.filter(c => selectedIds.has(c.id));
        if (onBatchAnalyze) {
            onBatchAnalyze(selectedClients);
            setSelectedIds(new Set()); // Reset
        }
    };

    // --- Stats Logic ---
    const today = new Date().toISOString().split('T')[0];
    const stats = {
        total: clients.length,
        actionNeeded: clients.filter(c => c.nextFollowUpDate && c.nextFollowUpDate <= today && c.status !== '流失/搁置').length,
        samples: clients.filter(c => c.isSampleNeeded).length
    };

    // --- Filtering ---
    const filteredClients = clients.filter(c => {
        const nameMatch = c.name ? c.name.toLowerCase().includes(filterName.toLowerCase()) : true;
        const countryMatch = c.country ? c.country.toLowerCase().includes(filterCountry.toLowerCase()) : true;
        const productMatch = c.productType ? c.productType.toLowerCase().includes(filterProduct.toLowerCase()) : true;
        
        const statusMatch = filterStatus === 'All' || c.status === filterStatus;
        const analyzedMatch = filterAnalyzed === 'All' 
            ? true 
            : filterAnalyzed === 'Yes' ? c.hasAnalyzed 
            : !c.hasAnalyzed;

        return nameMatch && countryMatch && productMatch && statusMatch && analyzedMatch;
    });

    const handleExportExcel = () => {
        const toExport = selectedIds.size > 0 
            ? clients.filter(c => selectedIds.has(c.id))
            : filteredClients.length > 0 ? filteredClients : clients;
            
        exportClientsToExcel(toExport);
    };

    // --- Helper Components ---
    const StatusBadge = ({ status }: { status: string }) => {
        const colors: Record<string, string> = {
            '新建/潜在': 'bg-blue-100 text-blue-700 border-blue-200',
            '已寄样': 'bg-orange-100 text-orange-700 border-orange-200',
            '谈判中': 'bg-purple-100 text-purple-700 border-purple-200',
            '已成交': 'bg-green-100 text-green-700 border-green-200',
            '流失/搁置': 'bg-slate-100 text-slate-500 border-slate-200',
        };
        return (
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${colors[status] || colors['新建/潜在']}`}>
                {status}
            </span>
        );
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-10">
            
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">客户跟进系统 (CRM)</h2>
                    <p className="text-slate-500 text-sm font-medium">贝比沃 · 高效管理 B2B 客户全生命周期</p>
                </div>
                <div className="flex gap-3">
                    <button 
                        onClick={handleExportExcel}
                        className="bg-white border border-slate-200 text-slate-700 hover:text-green-700 hover:border-green-300 px-5 py-2.5 rounded-xl font-bold shadow-sm flex items-center gap-2 transition-all active:scale-95"
                    >
                        <Download size={18} /> Export Excel
                    </button>
                    <button 
                        onClick={openNew}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-200 flex items-center gap-2 transition-transform active:scale-95"
                    >
                        <Plus size={18} /> 新增客户 (Add Client)
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="bg-blue-50 p-3 rounded-xl text-blue-600">
                        <Users size={24} />
                    </div>
                    <div>
                        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Clients</div>
                        <div className="text-2xl font-black text-slate-800">{stats.total}</div>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${stats.actionNeeded > 0 ? 'bg-red-50 text-red-600 animate-pulse' : 'bg-green-50 text-green-600'}`}>
                        <AlertCircle size={24} />
                    </div>
                    <div>
                        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Action Needed (待跟进)</div>
                        <div className={`text-2xl font-black ${stats.actionNeeded > 0 ? 'text-red-600' : 'text-slate-800'}`}>{stats.actionNeeded}</div>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="bg-orange-50 p-3 rounded-xl text-orange-600">
                        <Package size={24} />
                    </div>
                    <div>
                        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Sample Requests (寄样)</div>
                        <div className="text-2xl font-black text-slate-800">{stats.samples}</div>
                    </div>
                </div>
            </div>

            {/* Client List Table */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-4 w-12">
                                    <button onClick={() => toggleSelectAll(filteredClients)} className="text-slate-400 hover:text-blue-600">
                                        {filteredClients.length > 0 && filteredClients.every(c => selectedIds.has(c.id)) 
                                            ? <CheckSquare size={20} className="text-blue-600" /> 
                                            : <Square size={20} />
                                        }
                                    </button>
                                </th>
                                <th className="px-4 py-4 font-bold min-w-[150px]">Client Name</th>
                                <th className="px-4 py-4 font-bold min-w-[180px]">Website</th>
                                <th className="px-4 py-4 font-bold min-w-[120px]">Country</th>
                                <th className="px-4 py-4 font-bold min-w-[150px]">Suitable Product</th>
                                <th className="px-4 py-4 font-bold">Status</th>
                                <th className="px-4 py-4 font-bold">BG Check</th>
                                <th className="px-4 py-4 font-bold">Key Dates</th>
                                <th className="px-4 py-4 font-bold text-right">Actions</th>
                            </tr>
                            {/* Filter Row */}
                            <tr className="bg-slate-50/50 border-b border-slate-200">
                                <th className="px-4 py-2"></th>
                                <th className="px-4 py-2">
                                    <input placeholder="Filter Name..." value={filterName} onChange={e=>setFilterName(e.target.value)} className="w-full text-xs p-1 border rounded bg-white"/>
                                </th>
                                <th className="px-4 py-2"></th>
                                <th className="px-4 py-2">
                                    <input placeholder="Filter Country..." value={filterCountry} onChange={e=>setFilterCountry(e.target.value)} className="w-full text-xs p-1 border rounded bg-white"/>
                                </th>
                                <th className="px-4 py-2">
                                    <input placeholder="Filter Product..." value={filterProduct} onChange={e=>setFilterProduct(e.target.value)} className="w-full text-xs p-1 border rounded bg-white"/>
                                </th>
                                <th className="px-4 py-2">
                                    <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="w-full text-xs p-1 border rounded bg-white">
                                        <option value="All">All</option>
                                        <option value="新建/潜在">新建/潜在</option>
                                        <option value="已寄样">已寄样</option>
                                        <option value="谈判中">谈判中</option>
                                        <option value="已成交">已成交</option>
                                        <option value="流失/搁置">流失/搁置</option>
                                    </select>
                                </th>
                                <th className="px-4 py-2">
                                    <select value={filterAnalyzed} onChange={e=>setFilterAnalyzed(e.target.value)} className="w-full text-xs p-1 border rounded bg-white">
                                        <option value="All">All</option>
                                        <option value="Yes">Analyzed</option>
                                        <option value="No">Pending</option>
                                    </select>
                                </th>
                                <th className="px-4 py-2"></th>
                                <th className="px-4 py-2"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredClients.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-6 py-12 text-center text-slate-400 font-medium">
                                        No clients found matching your criteria.
                                    </td>
                                </tr>
                            ) : (
                                filteredClients.map((client) => (
                                    <tr key={client.id} className={`hover:bg-slate-50 transition-colors group ${selectedIds.has(client.id) ? 'bg-blue-50/30' : ''}`}>
                                        <td className="px-4 py-4">
                                            <button onClick={() => toggleSelect(client.id)} className="text-slate-400 hover:text-blue-600">
                                                {selectedIds.has(client.id) ? <CheckSquare size={20} className="text-blue-600"/> : <Square size={20}/>}
                                            </button>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="font-bold text-slate-900 text-sm">{client.name}</div>
                                            {client.activityLog && (
                                                <div className="mt-1 text-[10px] text-slate-400 italic line-clamp-1 max-w-[150px]">
                                                    {client.activityLog}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-4">
                                            <a href={client.website?.startsWith('http') ? client.website : `https://${client.website}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs flex items-center gap-1 max-w-[150px] truncate">
                                                <Globe size={12}/> {client.website || '-'}
                                            </a>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                                                {client.country}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded w-fit border border-slate-200">
                                                <ShoppingBag size={12} className="text-slate-400"/> {client.productType || "N/A"}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <StatusBadge status={client.status} />
                                        </td>
                                        <td className="px-4 py-4">
                                            {client.hasAnalyzed ? (
                                                <span className="flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-50 px-2 py-1 rounded-lg w-fit border border-green-100">
                                                    <ShieldCheck size={12} /> YES
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg w-fit">
                                                    NO
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex flex-col gap-1 text-[10px]">
                                                <div className={`flex items-center gap-1.5 font-medium ${
                                                    client.nextFollowUpDate && client.nextFollowUpDate <= today && client.status !== '流失/搁置' 
                                                    ? 'text-red-600' 
                                                    : 'text-slate-500'
                                                }`}>
                                                    <Clock size={10} /> 
                                                    Next: {client.nextFollowUpDate || '-'}
                                                </div>
                                                <div className="text-slate-400">Sent: {client.lastContactSent || '-'}</div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button 
                                                    onClick={() => openEdit(client)}
                                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                    title="Edit"
                                                >
                                                    <Edit3 size={14} />
                                                </button>
                                                <button 
                                                    onClick={() => handleDelete(client.id)}
                                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Delete"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Sticky Action Bar for Selection */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-6 animate-fade-in border border-slate-700">
                    <div className="font-bold text-sm pl-2">
                        <span className="text-blue-400 text-lg mr-1">{selectedIds.size}</span> Selected
                    </div>
                    <div className="h-8 w-px bg-slate-700"></div>
                    <button 
                        onClick={runBatchAnalysis}
                        className="bg-purple-600 hover:bg-purple-500 text-white px-5 py-2 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors shadow-lg"
                    >
                        <PlayCircle size={16} /> Batch Background Check
                    </button>
                </div>
            )}

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-fade-in custom-scrollbar">
                        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
                            <h3 className="text-xl font-black text-slate-800">
                                {editingClient ? 'Edit Client / 编辑客户' : 'Add New Client / 新增客户'}
                            </h3>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={24} />
                            </button>
                        </div>
                        
                        <form onSubmit={handleSave} className="p-8 space-y-6">
                            {/* Basic Info */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Company Name</label>
                                    <input name="name" required defaultValue={editingClient?.name} className="w-full input-base" placeholder="e.g. Toy Universe" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Website</label>
                                    <input name="website" defaultValue={editingClient?.website} className="w-full input-base" placeholder="e.g. www.toyuniverse.com" />
                                </div>
                            </div>
                            
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase">Country</label>
                                <input name="country" required defaultValue={editingClient?.country} className="w-full input-base" placeholder="e.g. USA" />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Type</label>
                                    <select name="type" defaultValue={editingClient?.type || '进口商'} className="w-full input-base">
                                        <option value="进口商">进口商</option>
                                        <option value="零售商">零售商</option>
                                        <option value="批发商">批发商</option>
                                        <option value="分销商">分销商</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Status</label>
                                    <select name="status" defaultValue={editingClient?.status || '新建/潜在'} className="w-full input-base">
                                        <option value="新建/潜在">新建/潜在</option>
                                        <option value="已寄样">已寄样</option>
                                        <option value="谈判中">谈判中</option>
                                        <option value="已成交">已成交</option>
                                        <option value="流失/搁置">流失/搁置</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Product Type (Suitable Product)</label>
                                    <input name="productType" defaultValue={editingClient?.productType} className="w-full input-base" placeholder="e.g. Toys" />
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-6 p-4 bg-slate-50 rounded-xl border border-slate-100">
                                <div className="space-y-1 flex-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Price Range</label>
                                    <input name="priceRange" defaultValue={editingClient?.priceRange} className="w-full input-base bg-white" placeholder="Low / Medium / High" />
                                </div>
                                <div className="flex items-center gap-3 pt-5">
                                    <input 
                                        type="checkbox" 
                                        name="isSampleNeeded" 
                                        id="isSampleNeeded"
                                        defaultChecked={editingClient?.isSampleNeeded} 
                                        className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                                    />
                                    <label htmlFor="isSampleNeeded" className="text-sm font-bold text-slate-700 select-none cursor-pointer">Sample Needed (需寄样)</label>
                                </div>
                            </div>

                            {/* Dates */}
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                    <Calendar size={12} /> Key Dates Tracking
                                </label>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-slate-400">Next Follow Up</span>
                                        <input type="date" name="nextFollowUpDate" defaultValue={editingClient?.nextFollowUpDate} className="w-full input-base text-xs" />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-slate-400">Last Contact Sent</span>
                                        <input type="date" name="lastContactSent" defaultValue={editingClient?.lastContactSent} className="w-full input-base text-xs" />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-slate-400">Last Received</span>
                                        <input type="date" name="lastContactReceived" defaultValue={editingClient?.lastContactReceived} className="w-full input-base text-xs" />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-slate-400">Last Order Date</span>
                                        <input type="date" name="lastOrderDate" defaultValue={editingClient?.lastOrderDate} className="w-full input-base text-xs" />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase">Activity Log / Notes</label>
                                <textarea 
                                    name="activityLog" 
                                    defaultValue={editingClient?.activityLog} 
                                    className="w-full input-base min-h-[100px]" 
                                    placeholder="Enter latest interaction details, meeting notes, etc."
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                                    Cancel
                                </button>
                                <button type="submit" className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-colors flex items-center gap-2">
                                    <Save size={18} /> Save Client
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <style>{`
                .input-base {
                    @apply border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all;
                }
            `}</style>
        </div>
    );
};
