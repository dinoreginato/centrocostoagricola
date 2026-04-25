import { toast } from 'sonner';

import React, { useState, useEffect, useCallback } from 'react';
import { useCompany, UserRole } from '../contexts/CompanyContext';
import { useAuth } from '../contexts/AuthContext';
import { Plus, Trash2, Mail, Shield, Loader2 } from 'lucide-react';
import { addCompanyMember, deleteCompanyAdmin, fetchAllCompaniesAdmin, fetchCompanyMembers, getUserIdByEmail, removeCompanyMember } from '../services/users';

interface Member {
  member_id: string;
  user_id: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export const Users: React.FC = () => {
  const { selectedCompany, userRole } = useCompany();
  const { user } = useAuth(); // Get current user for admin check
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  
  // Admin Company Management
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  
  // Form
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('editor');
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const loadAllCompaniesAdmin = useCallback(async () => {
      try {
        const data = await fetchAllCompaniesAdmin();
        setAllCompanies(data);
      } catch (error) {
        console.error('Error loading admin companies:', error);
      }
  }, []);

  const checkSystemAdmin = useCallback(async () => {
    if (user?.email === 'dino.reginato@gmail.com') {
      await loadAllCompaniesAdmin();
    }
  }, [loadAllCompaniesAdmin, user?.email]);

  const handleDeleteCompanyAdmin = async (id: string, name: string) => {
      if (!window.confirm(`PELIGRO: ¿Estás seguro de eliminar la empresa "${name}" y TODOS sus datos? Esta acción es irreversible.`)) return;
      
      try {
          await deleteCompanyAdmin({ targetCompanyId: id });
          toast('Empresa eliminada correctamente.');
          loadAllCompaniesAdmin();
      } catch (err: any) {
          toast.error('Error: ' + err.message);
      }
  };

  const loadMembers = useCallback(async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const data = await fetchCompanyMembers({ companyId: selectedCompany.id });
      setMembers(data || []);
    } catch (error) {
      console.error('Error loading members:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany]);

  useEffect(() => {
    if (selectedCompany) {
      void loadMembers();
    }
    void checkSystemAdmin();
  }, [selectedCompany, loadMembers, checkSystemAdmin]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;
    setAdding(true);
    setMessage(null);

    try {
      // 1. Get User ID by Email
      const userId = await getUserIdByEmail({ companyId: selectedCompany.id, email: newUserEmail });
      if (!userId) {
        throw new Error('Usuario no encontrado. Asegúrate de que esté registrado en la plataforma.');
      }

      // 2. Check if already member
      if (members.some(m => m.user_id === userId)) {
        throw new Error('El usuario ya es miembro de esta empresa.');
      }

      // 3. Add to company_members
      await addCompanyMember({ companyId: selectedCompany.id, userId, role: newUserRole });

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
      await removeCompanyMember({ memberId });
      setMembers(members.filter(m => m.member_id !== memberId));
    } catch (error) {
      console.error('Error removing member:', error);
      toast.error('Error al eliminar usuario.');
    }
  };

  if (!selectedCompany) return <div className="p-8">Seleccione una empresa</div>;
  if (userRole !== 'admin') return <div className="p-8">Acceso denegado. Solo administradores.</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* SUPER ADMIN PANEL - Only for Dino */}
      {user?.email === 'dino.reginato@gmail.com' && (
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
                {allCompanies.map((company) => (
                  <tr key={company.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{company.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{company.owner_email}</td>
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
                {allCompanies.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">Cargando empresas...</td>
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
      <div className="bg-white dark:bg-gray-800 shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-gray-100">Miembros Actuales</h3>
        </div>
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="animate-spin h-8 w-8 text-green-600" />
          </div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">No hay otros miembros en esta empresa.</div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {members.map((member) => (
              <li key={member.member_id} className="px-4 py-4 sm:px-6 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900">
                <div className="flex items-center">
                  <div className="flex-shrink-0 h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                    <span className="text-green-600 font-bold text-lg">{member.email[0].toUpperCase()}</span>
                  </div>
                  <div className="ml-4">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{member.email}</div>
                    <div className="flex items-center mt-1">
                      <Shield className="h-3 w-3 text-gray-400 mr-1" />
                      <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
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
