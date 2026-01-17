
import React, { useState, useEffect } from 'react';
import { useCompany, UserRole } from '../contexts/CompanyContext';
import { supabase } from '../supabase/client';
import { Plus, Trash2, Mail, Shield, Loader2 } from 'lucide-react';

interface Member {
  member_id: string;
  user_id: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export const Users: React.FC = () => {
  const { selectedCompany, userRole } = useCompany();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  
  // Form
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('editor');
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    if (selectedCompany) {
      loadMembers();
    }
  }, [selectedCompany]);

  const loadMembers = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      // Direct query to company_members joining with auth.users is tricky due to permissions.
      // We rely on the RPC 'get_company_members' which should bypass RLS or handle it correctly.
      // Let's verify the RPC is actually returning what we expect.
      const { data, error } = await supabase
        .rpc('get_company_members', { company_id_input: selectedCompany.id });

      if (error) {
        console.error('RPC Error:', error);
        throw error;
      }
      
      // If data is empty but we just added someone, it might be an RLS issue on the SELECT side of the RPC?
      // Or the RPC security definer is not set?
      setMembers(data || []);
    } catch (error) {
      console.error('Error loading members:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;
    setAdding(true);
    setMessage(null);

    try {
      // 1. Get User ID by Email
      const { data: userId, error: userError } = await supabase
        .rpc('get_user_id_by_email', { email_input: newUserEmail });

      if (userError) throw userError;
      if (!userId) {
        throw new Error('Usuario no encontrado. Asegúrate de que esté registrado en la plataforma.');
      }

      // 2. Check if already member
      if (members.some(m => m.user_id === userId)) {
        throw new Error('El usuario ya es miembro de esta empresa.');
      }

      // 3. Add to company_members
      const { error: insertError } = await supabase
        .from('company_members')
        .insert([{
          company_id: selectedCompany.id,
          user_id: userId,
          role: newUserRole
        }]);

      if (insertError) throw insertError;

      setMessage({ type: 'success', text: 'Usuario agregado exitosamente.' });
      setNewUserEmail('');
      loadMembers();
    } catch (error: any) {
      console.error('Error adding member:', error);
      setMessage({ type: 'error', text: error.message || 'Error al agregar usuario.' });
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!window.confirm('¿Estás seguro de eliminar a este usuario de la empresa?')) return;

    try {
      const { error } = await supabase
        .from('company_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;
      setMembers(members.filter(m => m.member_id !== memberId));
    } catch (error) {
      console.error('Error removing member:', error);
      alert('Error al eliminar usuario.');
    }
  };

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;
  if (userRole !== 'admin') return <div className="p-8">Acceso denegado. Solo administradores.</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestión de Usuarios</h1>
          <p className="text-sm text-gray-500">Administra quién tiene acceso a {selectedCompany.name}</p>
        </div>
      </div>

      {/* Add Member Form */}
      <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Agregar Nuevo Miembro</h3>
        <form onSubmit={handleAddMember} className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 mb-1">Correo Electrónico</label>
            <div className="relative">
              <Mail className="absolute top-2.5 left-3 h-4 w-4 text-gray-400" />
              <input
                type="email"
                required
                value={newUserEmail}
                onChange={e => setNewUserEmail(e.target.value)}
                className="pl-10 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                placeholder="usuario@ejemplo.com"
              />
            </div>
          </div>
          <div className="w-full md:w-48">
            <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
            <select
              value={newUserRole}
              onChange={e => setNewUserRole(e.target.value as UserRole)}
              className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
            >
              <option value="admin">Administrador</option>
              <option value="editor">Campo (Bodega/Apps)</option>
              <option value="viewer">Observador</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={adding}
            className="w-full md:w-auto inline-flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
          >
            {adding ? <Loader2 className="animate-spin h-5 w-5" /> : <><Plus className="mr-2 h-4 w-4" /> Agregar</>}
          </button>
        </form>
        {message && (
          <div className={`mt-4 p-2 rounded text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {message.text}
          </div>
        )}
      </div>

      {/* Members List */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Miembros Actuales</h3>
        </div>
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="animate-spin h-8 w-8 text-green-600" />
          </div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No hay otros miembros en esta empresa.</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {members.map((member) => (
              <li key={member.member_id} className="px-4 py-4 sm:px-6 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center">
                  <div className="flex-shrink-0 h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                    <span className="text-green-600 font-bold text-lg">{member.email[0].toUpperCase()}</span>
                  </div>
                  <div className="ml-4">
                    <div className="text-sm font-medium text-gray-900">{member.email}</div>
                    <div className="flex items-center mt-1">
                      <Shield className="h-3 w-3 text-gray-400 mr-1" />
                      <span className="text-xs text-gray-500 capitalize">
                        {member.role === 'editor' ? 'Campo' : member.role}
                      </span>
                    </div>
                  </div>
                </div>
                {member.role !== 'admin' && ( // Prevent removing admins easily or self-removal check logic could be added
                   <button
                     onClick={() => handleRemoveMember(member.member_id)}
                     className="text-gray-400 hover:text-red-600 p-2"
                     title="Eliminar miembro"
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
