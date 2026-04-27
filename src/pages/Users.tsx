import { toast } from 'sonner';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCompany, UserRole } from '../contexts/CompanyContext';
import { useAuth } from '../contexts/AuthContext';
import { Plus, Trash2, Mail, Shield, Loader2, Search } from 'lucide-react';
import { AdminCompanyRow, deleteCompanyAdmin, fetchAllCompaniesAdmin, fetchCompanyMembers, fetchIsSystemAdmin, removeCompanyMember, removeCompanyMembers, updateCompanyMemberRole, upsertCompanyMemberByEmail } from '../services/users';

interface Member {
  member_id: string;
  user_id: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export const Users: React.FC = () => {
  const { selectedCompany, userRole } = useCompany();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const companyId = useMemo(() => selectedCompany?.id ?? null, [selectedCompany?.id]);

  // Form
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('editor');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  const isSystemAdminQuery = useQuery({
    queryKey: ['isSystemAdmin'],
    queryFn: fetchIsSystemAdmin,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });

  const allCompaniesQuery = useQuery({
    queryKey: ['allCompaniesAdmin'],
    queryFn: fetchAllCompaniesAdmin,
    enabled: Boolean(isSystemAdminQuery.data),
    staleTime: 30_000,
  });

  const membersQuery = useQuery({
    queryKey: ['companyMembers', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      return (await fetchCompanyMembers({ companyId })) as Member[];
    },
    enabled: Boolean(companyId) && (userRole === 'admin' || userRole === 'editor'),
    staleTime: 10_000,
  });

  const upsertMemberMutation = useMutation({
    mutationFn: async () => {
      if (!companyId) return;
      await upsertCompanyMemberByEmail({ companyId, email: newUserEmail, role: newUserRole });
    },
    onSuccess: async () => {
      toast.success('Usuario agregado/actualizado.');
      setNewUserEmail('');
      await queryClient.invalidateQueries({ queryKey: ['companyMembers', companyId] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Error al agregar usuario.');
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      if (!companyId) return;
      await removeCompanyMember({ companyId, memberId });
    },
    onSuccess: (_data, memberId) => {
      queryClient.setQueryData<Member[]>(['companyMembers', companyId], (prev) => (prev || []).filter((m) => m.member_id !== memberId));
      setSelectedMemberIds((prev) => prev.filter((x) => x !== memberId));
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Error al eliminar usuario.');
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async (params: { memberId: string; role: UserRole }) => {
      if (!companyId) return;
      await updateCompanyMemberRole({ companyId, memberId: params.memberId, role: params.role });
      return params;
    },
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ['companyMembers', companyId] });
      const previous = queryClient.getQueryData<Member[]>(['companyMembers', companyId]) || [];
      queryClient.setQueryData<Member[]>(['companyMembers', companyId], (prev) =>
        (prev || []).map((m) => (m.member_id === params.memberId ? { ...m, role: params.role } : m)),
      );
      return { previous };
    },
    onError: (err: any, _params, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['companyMembers', companyId], ctx.previous);
      toast.error(err?.message || 'Error al actualizar rol.');
    },
    onSuccess: () => {
      toast.success('Rol actualizado.');
    },
  });

  const bulkRemoveMembersMutation = useMutation({
    mutationFn: async () => {
      if (!companyId) return;
      await removeCompanyMembers({ companyId, memberIds: selectedMemberIds });
    },
    onSuccess: () => {
      queryClient.setQueryData<Member[]>(['companyMembers', companyId], (prev) => (prev || []).filter((m) => !selectedMemberIds.includes(m.member_id)));
      setSelectedMemberIds([]);
      toast.success('Miembros eliminados.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Error al eliminar miembros.');
    },
  });

  const deleteCompanyAdminMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteCompanyAdmin({ targetCompanyId: id });
    },
    onSuccess: async () => {
      toast('Empresa eliminada correctamente.');
      await queryClient.invalidateQueries({ queryKey: ['allCompaniesAdmin'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Error al eliminar empresa.');
    },
  });

  const handleDeleteCompanyAdmin = async (id: string, name: string) => {
    if (!window.confirm(`PELIGRO: ¿Estás seguro de eliminar la empresa "${name}" y TODOS sus datos? Esta acción es irreversible.`)) return;
    deleteCompanyAdminMutation.mutate(id);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    await upsertMemberMutation.mutateAsync();
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!window.confirm('¿Estás seguro de eliminar a este usuario de la empresa?')) return;
    await removeMemberMutation.mutateAsync(memberId);
  };

  const members = useMemo(() => (membersQuery.data || []) as Member[], [membersQuery.data]);
  const filteredMembers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => String(m.email || '').toLowerCase().includes(q));
  }, [members, searchTerm]);

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;
  if (userRole !== 'admin' && userRole !== 'editor') return <div className="p-8">Acceso denegado.</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* SUPER ADMIN PANEL - Only for Dino */}
      {Boolean(isSystemAdminQuery.data) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold text-red-800 mb-4 flex items-center">
            <Shield className="h-6 w-6 mr-2" /> Panel de Super Admin (Gestión de Empresas)
          </h2>
          <p className="text-sm text-red-600 mb-4">
            Aquí puedes ver todas las empresas creadas en la plataforma y eliminarlas si es necesario.
          </p>
          
          <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Empresa</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Dueño</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Creada</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Acción</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {(allCompaniesQuery.data || []).map((company: AdminCompanyRow) => (
                  <tr key={company.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{company.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{company.owner_email || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {new Date(company.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        onClick={() => handleDeleteCompanyAdmin(company.id, company.name)}
                        className="text-red-600 hover:text-red-900 font-bold"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
                {(allCompaniesQuery.data || []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                      {allCompaniesQuery.isLoading ? 'Cargando empresas...' : 'No hay empresas.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Gestión de Usuarios</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Administra quién tiene acceso a {selectedCompany.name}</p>
        </div>
      </div>

      {/* Add Member Form */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Agregar Nuevo Miembro</h3>
        <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4">
            <div className="flex">
                <div className="flex-shrink-0">
                    <Shield className="h-5 w-5 text-blue-400" />
                </div>
                <div className="ml-3">
                    <p className="text-sm text-blue-700">
                        Para que otros usuarios vean y modifiquen estos mismos datos, agrégalos aquí. 
                        <br />
                        <strong>Importante:</strong> El usuario debe haberse registrado previamente en la plataforma.
                    </p>
                </div>
            </div>
        </div>
        <form onSubmit={handleAddMember} className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Correo Electrónico</label>
            <div className="relative">
              <Mail className="absolute top-2.5 left-3 h-4 w-4 text-gray-400" />
              <input
                type="email"
                required
                value={newUserEmail}
                onChange={e => setNewUserEmail(e.target.value)}
                className="pl-10 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                placeholder="usuario@ejemplo.com"
              />
            </div>
          </div>
          <div className="w-full md:w-48">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rol</label>
            <select
              value={newUserRole}
              onChange={e => setNewUserRole(e.target.value as UserRole)}
              className="block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
            >
              <option value="admin">Administrador</option>
              <option value="editor">Campo (Bodega/Apps)</option>
              <option value="viewer">Observador</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={upsertMemberMutation.isPending}
            className="w-full md:w-auto inline-flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
          >
            {upsertMemberMutation.isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <><Plus className="mr-2 h-4 w-4" /> Agregar</>}
          </button>
        </form>
      </div>

      {/* Members List */}
      <div className="bg-white dark:bg-gray-800 shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-gray-100">Miembros Actuales</h3>
            <div className="flex items-center gap-2">
              {selectedMemberIds.length > 0 ? (
                <>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{selectedMemberIds.length} seleccionados</span>
                  <button
                    type="button"
                    onClick={() => setSelectedMemberIds([])}
                    className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900"
                    disabled={bulkRemoveMembersMutation.isPending}
                  >
                    Limpiar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`¿Eliminar ${selectedMemberIds.length} miembros?`)) return;
                      bulkRemoveMembersMutation.mutate();
                    }}
                    className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-700 bg-white dark:bg-gray-800 hover:bg-red-50 disabled:opacity-50"
                    disabled={bulkRemoveMembersMutation.isPending}
                  >
                    Eliminar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setSelectedMemberIds(filteredMembers.filter((m) => m.user_id !== user?.id).map((m) => m.member_id))}
                  className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 disabled:opacity-50"
                  disabled={filteredMembers.length === 0}
                >
                  Seleccionar todo
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por email..."
              className="pl-9 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
            />
          </div>
        </div>
        {membersQuery.isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="animate-spin h-8 w-8 text-green-600" />
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">No hay otros miembros en esta empresa.</div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredMembers.map((member) => (
              <li key={member.member_id} className="px-4 py-4 sm:px-6 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900">
                <div className="flex items-center">
                  <div className="mr-3">
                    <input
                      type="checkbox"
                      checked={selectedMemberIds.includes(member.member_id)}
                      disabled={member.user_id === user?.id}
                      onChange={() =>
                        setSelectedMemberIds((prev) =>
                          prev.includes(member.member_id) ? prev.filter((x) => x !== member.member_id) : [...prev, member.member_id],
                        )
                      }
                      className="h-4 w-4 accent-green-600 disabled:opacity-50"
                    />
                  </div>
                  <div className="flex-shrink-0 h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                    <span className="text-green-600 font-bold text-lg">{member.email[0].toUpperCase()}</span>
                  </div>
                  <div className="ml-4">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{member.email}</div>
                    <div className="flex items-center mt-1">
                      <Shield className="h-3 w-3 text-gray-400 mr-1" />
                      {member.user_id === user?.id ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                          {member.role === 'editor' ? 'Campo' : member.role} (tú)
                        </span>
                      ) : (
                        <select
                          value={member.role}
                          onChange={(e) => updateRoleMutation.mutate({ memberId: member.member_id, role: e.target.value as UserRole })}
                          disabled={updateRoleMutation.isPending}
                          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                        >
                          <option value="admin">Administrador</option>
                          <option value="editor">Campo</option>
                          <option value="viewer">Observador</option>
                        </select>
                      )}
                    </div>
                  </div>
                </div>
                {member.user_id !== user?.id && (
                  <button
                    onClick={() => handleRemoveMember(member.member_id)}
                    className="text-gray-400 hover:text-red-600 p-2 disabled:opacity-50"
                    title="Eliminar miembro"
                    disabled={removeMemberMutation.isPending}
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
