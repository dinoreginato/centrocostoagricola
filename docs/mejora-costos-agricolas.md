# Mejora De Costos Agricolas

## Objetivo
Dejar la aplicacion mas confiable para gestion agricola real, con costos mas verdaderos, menos duplicidad y una mejor resolucion de datos para toma de decisiones.

## Lo Que Ya Esta Bien
- Modelo predial correcto: `empresa -> campo -> sector`.
- Buen nivel operativo en aplicaciones, ordenes, inventario y reportes ejecutivos.
- Regla de temporada consistente mayo-abril.
- Capacidad de costear por hectarea y por sector.
- Integracion util entre compras, inventario, aplicaciones e ingresos.

## Problemas Principales
- No existe una fuente canonica unica para los movimientos de costo.
- Un mismo costo puede aparecer por varias vias: factura, asignacion, costo manual, trabajador o consumo.
- La clasificacion de varios costos depende de texto libre y heuristicas.
- Parte de la logica de negocio vive en pantallas grandes y no en una capa comun.
- Produccion e ingresos todavia no gobiernan toda la lectura economica.

## Riesgos Para La Verdad Del Dato
- Duplicidad de mano de obra entre `labor_assignments` y `worker_costs`.
- Duplicidad o sobrelectura de combustible entre `fuel_assignments` y `fuel_consumption`.
- Distorsion de costo historico por uso de promedios globales en combustible.
- Costos generales forzados a sector sin preservar nivel original de origen.
- Ingresos y temporadas con riesgo de inconsistencia si solo se validan en frontend.
- Reportes y dashboard pueden divergir si no consumen reglas compartidas.

## Decisiones De Diseno Recomendadas
- Definir una capa canonica de `movimientos de costo`.
- Separar origen del costo de su distribucion:
  - origen: factura, trabajador, combustible, gasto manual, maquinaria, riego.
  - distribucion: empresa, campo, sector.
- Normalizar categorias con catalogos cerrados:
  - costo directo
  - costo indirecto predial
  - costo corporativo
  - costo comercial
  - costo financiero
- Mantener temporada derivada desde fecha en backend o SQL, no solo en frontend.
- Tratar produccion como dato estructural de margen, no como dato accesorio.

## Arquitectura Objetivo
1. Capa maestra de temporadas y fechas.
2. Capa canonica de movimientos de costo.
3. Capa de asignacion y prorrateo.
4. Capa de metricas:
   - costo total
   - costo por ha
   - costo por kg
   - presupuesto vs real
   - margen por sector
5. Capa de visualizacion:
   - dashboard
   - reportes
   - exportaciones

## Plan De Implementacion
### Fase 1
- Centralizar temporadas disponibles y filtros compartidos.
- Hacer que dashboard y reportes consuman la misma logica base.
- Incorporar todos los costos visibles al consolidado.

### Fase 2
- Crear una utilidad o vista canonica de movimientos de costo.
- Trazar para cada registro:
  - fecha
  - temporada
  - empresa
  - campo
  - sector
  - categoria
  - subcategoria
  - monto
  - origen
  - id_origen

### Fase 3
- Eliminar duplicidades de mano de obra.
- Definir una regla oficial entre `labor_assignments` y `worker_costs`.
- Eliminar duplicidades de combustible y definir valorizacion historica.

### Fase 4
- Integrar produccion a todas las metricas economicas.
- Hacer obligatoria la coherencia entre kilos, ingresos y temporada.

### Fase 5
- Agregar validaciones fuertes en base de datos:
  - porcentajes 0 a 100
  - montos no negativos cuando corresponda
  - coherencia campo/sector/empresa
  - coherencia hectareas campo vs sectores

## Acciones Prioritarias
- Prioridad alta: capa compartida de temporadas y costos.
- Prioridad alta: reglas anti duplicacion para mano de obra y combustible.
- Prioridad alta: fuente unica para dashboard y reportes.
- Prioridad media: fortalecer produccion e ingresos.
- Prioridad media: catalogos cerrados para tipos de costo.

## Cambios Base Aplicados
- Se creo una utilidad compartida en `src/lib/agriculturalData.ts` para:
  - parsear fechas agricolas
  - derivar temporada desde fecha
  - filtrar registros por temporada
  - construir temporadas disponibles desde distintas fuentes
- Se creo una utilidad canonica en `src/lib/costMovements.ts` para transformar costos operativos en movimientos compartidos por:
  - aplicaciones
  - labores
  - trabajadores
  - combustible
  - maquinaria
  - riego
  - generales
- Se aplico esta capa a:
  - `src/services/dashboard.ts`
  - `src/services/reports.ts`

## Reglas Oficiales De Costo
- Mano de obra:
  - `worker_costs` representa costo directo de trabajadores propios.
  - `labor_assignments` representa costo asignado desde factura o distribucion de labor.
  - Si existe coincidencia fuerte por `sector + fecha + tipo de labor + monto`, se considera probable duplicidad y se prioriza `worker_costs`.
- Combustible:
  - `fuel_consumption` es la fuente oficial cuando existe bitacora real en terreno.
  - `fuel_assignments` queda como respaldo contable cuando no existe consumo registrado para ese `sector + mes`.
- Temporadas:
  - siempre se derivan desde fecha con regla agricola compartida.
- Reporteria:
  - `Dashboard` y `Reportes` deben leer la misma consolidacion y no recalcular reglas distintas por separado.

## Vista SQL Canonica
- Se agrego la migracion `supabase/migrations/20260623170000_create_agricultural_cost_movements_view.sql`.
- Esta migracion crea:
  - la funcion `public.agricultural_season_from_date(date)`
  - la vista `public.v_agricultural_cost_movements`
- La vista entrega una capa comun con:
  - `company_id`
  - `field_id`
  - `field_name`
  - `sector_id`
  - `sector_name`
  - `movement_date`
  - `season`
  - `category`
  - `subcategory`
  - `amount`
  - `source_type`
  - `origin_type`
  - `origin_id`
  - banderas `is_official` e `is_fallback`
- La vista ya incorpora reglas de prioridad:
  - excluye `fuel_assignments` cuando existe `fuel_consumption` real en el mismo sector y mes
  - excluye `labor_assignments` cuando detecta coincidencia fuerte con `worker_costs` manuales del mismo sector, fecha y labor
- Esta vista debe ser la siguiente fuente oficial para migrar:
  - dashboard
  - reportes
  - futuras conciliaciones de costos

## Siguiente Paso Recomendado
- Crear una vista o servicio canonico de movimientos de costo y migrar primero `Dashboard` y `Reportes` para que lean exactamente la misma consolidacion.
