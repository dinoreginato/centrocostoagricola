-- Drop the existing constraint
ALTER TABLE "public"."products" DROP CONSTRAINT IF EXISTS "products_category_check";

-- Add the new constraint with the expanded list of categories
ALTER TABLE "public"."products" ADD CONSTRAINT "products_category_check" 
CHECK (category IN (
  'Quimicos', 
  'Plaguicida', 
  'Insecticida', 
  'Fungicida', 
  'Herbicida', 
  'Fertilizantes', 
  'Petroleo', 
  'Transporte', 
  'Mano de obra', 
  'Labores agrícolas', 
  'Riego', 
  'Maquinaria', 
  'Servicios', 
  'Insumo', 
  'Repuesto', 
  'Combustible', 
  'Honorarios', 
  'Otros',
  'fertilizante', -- Keeping old lowercase ones just in case data exists
  'pesticida',
  'herbicida',
  'fungicida',
  'otro'
));
