
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabase/client';
import { useAuth } from './AuthContext';

export interface Company {
  id: string;
  name: string;
  rut: string | null;
  owner_id: string;
  application_fuel_rate?: number;
}

export type UserRole = 'admin' | 'editor' | 'viewer';

interface CompanyContextType {
  companies: Company[];
  selectedCompany: Company | null;
  userRole: UserRole | null;
  loading: boolean;
  selectCompany: (companyId: string) => void;
  refreshCompanies: () => Promise<void>;
  addCompany: (company: Company) => void;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserRole = useCallback(async (company: Company, userId: string) => {
    if (company.owner_id === userId) {
      setUserRole('admin');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('company_members')
        .select('role')
        .eq('company_id', company.id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      
      if (data) {
        setUserRole(data.role as UserRole);
      } else {
        setUserRole('viewer'); // Default fallback
      }
    } catch (error) {
      console.error('Error fetching role:', error);
      setUserRole('viewer');
    }
  }, []);

  const refreshCompanies = useCallback(async () => {
    if (!user) {
      setCompanies([]);
      setSelectedCompany(null);
      setUserRole(null);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setCompanies(data || []);

      // Auto-claim orphan companies
      if (data && user) {
        const orphans = data.filter(c => !c.owner_id);
        if (orphans.length > 0) {
          orphans.forEach(async (orphan) => {
            try {
              await supabase
                .from('companies')
                .update({ owner_id: user.id })
                .eq('id', orphan.id);
              // Optimistically update local state
              orphan.owner_id = user.id;
            } catch (err) {
              console.error('Error claiming orphan company:', err);
            }
          });
        }
      }

      // Restore selected company from local storage or default to first
      const savedCompanyId = localStorage.getItem('selectedCompanyId');
      let currentCompany = null;

      if (savedCompanyId) {
        const found = data?.find(c => c.id === savedCompanyId);
        if (found) currentCompany = found;
      } 
      
      if (!currentCompany && data && data.length > 0) {
        currentCompany = data[0];
      }

      if (currentCompany) {
        setSelectedCompany(currentCompany);
        await fetchUserRole(currentCompany, user.id);
      } else {
        setSelectedCompany(null);
        setUserRole(null);
      }
    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      setLoading(false);
    }
  }, [fetchUserRole, user]);

  useEffect(() => {
    refreshCompanies();
  }, [refreshCompanies]);

  const selectCompany = async (companyId: string) => {
    const company = companies.find(c => c.id === companyId);
    if (company && user) {
      setSelectedCompany(company);
      localStorage.setItem('selectedCompanyId', companyId);
      await fetchUserRole(company, user.id);
    }
  };

  const addCompany = (company: Company) => {
    setCompanies([company, ...companies]);
    setSelectedCompany(company);
    setUserRole('admin'); // Creator is admin
    localStorage.setItem('selectedCompanyId', company.id);
  };

  return (
    <CompanyContext.Provider value={{ 
      companies, 
      selectedCompany, 
      userRole,
      loading, 
      selectCompany, 
      refreshCompanies,
      addCompany 
    }}>
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
};
