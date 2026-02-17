-- Create table for production records per sector and year
CREATE TABLE production_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id uuid REFERENCES sectors(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  kg_produced numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(sector_id, season_year)
);

-- Enable RLS
ALTER TABLE production_records ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view production records for their company" ON production_records
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sectors s
      JOIN fields f ON s.field_id = f.id
      WHERE s.id = production_records.sector_id
      AND f.company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1)
    )
  );

CREATE POLICY "Users can insert production records for their company" ON production_records
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sectors s
      JOIN fields f ON s.field_id = f.id
      WHERE s.id = production_records.sector_id
      AND f.company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1)
    )
  );

CREATE POLICY "Users can update production records for their company" ON production_records
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM sectors s
      JOIN fields f ON s.field_id = f.id
      WHERE s.id = production_records.sector_id
      AND f.company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1)
    )
  );

CREATE POLICY "Users can delete production records for their company" ON production_records
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM sectors s
      JOIN fields f ON s.field_id = f.id
      WHERE s.id = production_records.sector_id
      AND f.company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1)
    )
  );
