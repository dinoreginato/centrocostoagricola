-- Drop the existing constraint
ALTER TABLE "public"."products" DROP CONSTRAINT IF EXISTS "products_category_check";

-- Add the new constraint including Archivado (used for soft-delete/archiving inventory products)
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
  'Archivado',
  'fertilizante',
  'pesticida',
  'herbicida',
  'fungicida',
  'otro'
));
