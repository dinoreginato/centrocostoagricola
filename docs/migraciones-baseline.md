# Baseline / limpieza de migraciones (modo conservador)

Este repositorio ya está desplegado, por lo que **no es seguro** borrar ni renombrar migraciones que podrían estar aplicadas en entornos productivos.

## Objetivo práctico

- Mantener despliegues seguros (solo agregar migraciones nuevas).
- Tener un camino claro para “squash/baseline” cuando se cree un entorno nuevo desde cero.
- Evitar que migraciones legacy sigan afectando el estado final (por eso existen migraciones de “reset” que reestablecen policies/funciones).

## Qué se recomienda hacer en producción

- **No** borrar ni renombrar archivos en `supabase/migrations/`.
- Para cambios de esquema/RLS/RPCs, crear **solo** migraciones nuevas con timestamp.
- Si hay que “corregir” un legado, hacerlo con migraciones nuevas idempotentes (`IF EXISTS`, `DROP ... IF EXISTS`, `ALTER ... IF NOT EXISTS`).

## Qué se recomienda hacer para un entorno nuevo (staging/dev desde cero)

1. Crear un proyecto/instancia limpia.
2. Aplicar migraciones en orden.
3. Verificar especialmente que queden aplicadas las migraciones de hardening/normalización recientes:
   - Reset de policies a viewer/admin/editor.
   - Hardening de privilegios de `authenticated` (evitar `GRANT ALL` / `TRUNCATE`).
   - Hardening de `SECURITY DEFINER` (`SET search_path = public` + `REVOKE` a `PUBLIC`).
4. Validar con el script interno del repo:
   - `npm run check:boundaries`

## Dónde están las “fuentes de verdad” actuales (en este repo)

- RLS normalizado (viewer read / admin+editor write):
  - `supabase/migrations/20260422210000_reset_rls_policies_viewer_role.sql`
- Privilegios DB (sin `GRANT ALL` a authenticated):
  - `supabase/migrations/20260422211000_harden_authenticated_db_privileges.sql`
- Helper functions endurecidas (REVOKE a PUBLIC):
  - `supabase/migrations/20260422202000_harden_rls_helper_functions.sql`
- Company members management vía RPC (evitar writes directos desde frontend):
  - `supabase/migrations/20260422213000_company_members_management_rpcs.sql`

