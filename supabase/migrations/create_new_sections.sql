
CREATE TABLE IF NOT EXISTS fuel_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid REFERENCES invoice_items(id),
  sector_id uuid REFERENCES sectors(id),
  assigned_amount numeric NOT NULL CHECK (assigned_amount > 0),
  assigned_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS machinery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid REFERENCES invoice_items(id),
  sector_id uuid REFERENCES sectors(id),
  assigned_amount numeric NOT NULL CHECK (assigned_amount > 0),
  assigned_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS irrigation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid REFERENCES invoice_items(id),
  sector_id uuid REFERENCES sectors(id),
  assigned_amount numeric NOT NULL CHECK (assigned_amount > 0),
  assigned_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE fuel_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE machinery_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE irrigation_assignments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to be safe on re-runs)
DROP POLICY IF EXISTS "fuel_access" ON fuel_assignments;
DROP POLICY IF EXISTS "machinery_access" ON machinery_assignments;
DROP POLICY IF EXISTS "irrigation_access" ON irrigation_assignments;

-- Create Policies
CREATE POLICY "fuel_access" ON fuel_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "machinery_access" ON machinery_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "irrigation_access" ON irrigation_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Grant permissions
GRANT ALL ON fuel_assignments TO authenticated;
GRANT ALL ON machinery_assignments TO authenticated;
GRANT ALL ON irrigation_assignments TO authenticated;
