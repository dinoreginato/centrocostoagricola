-- Fix company deletion by adding CASCADE delete to company_members
-- The previous error showed a foreign key constraint violation on 'company_members'
-- when deleting a company. This migration fixes the FK to cascade delete.

ALTER TABLE company_members
DROP CONSTRAINT IF EXISTS company_members_company_id_fkey;

ALTER TABLE company_members
ADD CONSTRAINT company_members_company_id_fkey
FOREIGN KEY (company_id)
REFERENCES companies(id)
ON DELETE CASCADE;
