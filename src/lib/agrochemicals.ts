export const AGROCHEMICAL_CATEGORIES = [
  'Quimicos',
  'Plaguicida',
  'Insecticida',
  'Fungicida',
  'Herbicida',
  'Fertilizantes',
  'fertilizante',
  'pesticida',
  'herbicida',
  'fungicida',
  'fungicida',
  'insecticida',
  'herbicida',
  'fertilizante',
  'regulador',
  'coadyuvante',
  'bioestimulante',
  'nutricional',
  'enmienda',
  'corrector',
  'acaricida',
  'nematicida',
  'desecante',
  'fertirriego',
  'adherente',
  'aceite',
];

const AGROCHEMICAL_KEYWORDS = [
  'fertilizante',
  'plaguicida',
  'insecticida',
  'fungicida',
  'herbicida',
  'quimico',
  'agro',
  'urea',
  'salitre',
  'potasio',
  'fosforo',
  'nitrato',
  'sulfato',
];

export function isAgrochemicalProduct(params: { name?: string | null; category?: string | null }) {
  const cat = String(params.category || '').toLowerCase().trim();
  const name = String(params.name || '').toLowerCase().trim();

  if (AGROCHEMICAL_CATEGORIES.some((c) => c.toLowerCase() === cat)) return true;
  return AGROCHEMICAL_KEYWORDS.some((term) => cat.includes(term) || name.includes(term));
}

export function filterAgrochemicalProducts<T extends { name?: string | null; category?: string | null }>(products: T[]) {
  return products.filter((p) => isAgrochemicalProduct({ name: p.name, category: p.category }));
}
