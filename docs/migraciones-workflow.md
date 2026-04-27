# Workflow de migraciones (prod-safe)

Este proyecto ya está desplegado, así que el objetivo es **no romper entornos existentes** y a la vez mantener un camino de instalación nuevo lo más sano posible.

## Reglas

- No borrar ni renombrar migraciones que puedan estar aplicadas en producción.
- Para cambios nuevos, agregar siempre migraciones con nombre:
  - `YYYYMMDDHHMMSS_descripcion.sql`
- Preferir cambios idempotentes:
  - `CREATE ... IF NOT EXISTS`, `DROP ... IF EXISTS`
  - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  - Para RLS/policies: `DROP POLICY IF EXISTS` antes de crear.
- Para `SECURITY DEFINER`:
  - `SET search_path = public`
  - `REVOKE ALL ... FROM PUBLIC` y `GRANT EXECUTE ... TO authenticated` según corresponda.

## Checks automatizados

- Reporte (no falla CI): `npm run check:migrations`
- Modo estricto (falla si detecta issues): `npm run check:migrations:strict`

Qué valida:
- Archivos timestamped con formato `YYYYMMDDHHMMSS_*.sql`
- Detección de timestamps duplicados (riesgo alto)
- Listado de archivos legacy (no timestamp) que Supabase CLI no aplica automáticamente

## Estado actual del repo (historical)

- Existen timestamps duplicados históricos (principalmente en fixes de RLS/recursión).
- La postura prod-safe es no renombrarlos: se mitiga “re-aplicando” el estado canónico después con migraciones nuevas idempotentes.
- Consolidación canónica de helpers/policies de membresía:
  - `supabase/migrations/20260422215000_consolidate_company_access_helpers.sql`
- Consolidación canónica de RLS final (re-aplica policies en tablas clave):
  - `supabase/migrations/20260422216000_consolidate_rls_policies.sql`
- Consolidación canónica de viewer role (rol permitido + hardening de columna supplier_rut):
  - `supabase/migrations/20260422217000_consolidate_viewer_role.sql`
- Consolidación canónica de price_per_kg (income_entries + production_records):
  - `supabase/migrations/20260422218000_consolidate_price_per_kg.sql`

## Cómo resolver timestamps duplicados (sin romper prod)

Si existen dos migraciones con el mismo `YYYYMMDDHHMMSS`:
- No es seguro renombrar una ya aplicada.
- En vez de eso, crear una migración nueva (timestamp nuevo) que:
  - Re-aplique el objetivo de la “segunda” migración de forma idempotente.
  - No dependa del orden exacto de la migración duplicada.
- Luego, dejar la migración duplicada como legacy/archivo (sin eliminar en prod), y documentarlo.

## Checklist antes de deploy DB

- Correr `npm run check:migrations:strict`.
- Revisar que cualquier RPC nueva esté con `REVOKE/GRANT` correctos.
- Revisar que cualquier cambio en RLS sea idempotente.
