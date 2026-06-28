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

## Capa De Conciliacion
- Se agrego la migracion `supabase/migrations/20260623183000_create_agricultural_cost_reconciliation_views.sql`.
- Esta migracion crea:
  - `public.v_agricultural_cost_reconciliation`
  - `public.v_agricultural_cost_reconciliation_summary`
- La capa de conciliacion clasifica cada movimiento con:
  - `cost_role`: oficial, respaldo o distribucion
  - `source_layer`: operacional, distribucion, manual o contable
  - `audit_status`: trazable, respaldo contable, costo manual, monto cero o faltantes estructurales
  - `review_priority`: alta, media o baja
  - `has_full_traceability`
  - `reconciliation_key`
- Esto permite distinguir:
  - costo operativo real
  - costo distribuido desde factura
  - costo de respaldo contable
  - costo que necesita revision
- Tambien se creo el servicio `src/services/costAudit.ts` para leer:
  - detalle de conciliacion
  - resumen de conciliacion por temporada y categoria

## Uso Recomendado De La Conciliacion
- Crear una pantalla o drawer ejecutivo de auditoria de costos.
- Mostrar:
  - monto trazable
  - monto en respaldo
  - monto distribuido
  - monto con revision alta
- Usar esta capa para alertas de calidad del dato antes de presentar reportes al directorio.

## Capa De Margen Canonico
- Se agrego la migracion `supabase/migrations/20260627123000_create_agricultural_margin_view.sql`.
- Esta vista crea una lectura comun de rentabilidad por:
  - empresa
  - campo
  - sector
  - temporada
- La vista une:
  - `v_agricultural_cost_movements` como base oficial de costos
  - `income_entries` como base comercial de ingresos
  - `production_records` como fuente prioritaria de produccion cuando exista
- La vista entrega:
  - costo total
  - ingreso total CLP y USD
  - kg exportados
  - kg jugo
  - kg vendidos
  - kg producidos
  - costo por ha
  - costo por kg
  - utilidad
  - margen porcentual
  - `production_source`
- Regla clave:
  - si existe `production_records`, la produccion oficial se toma desde ahi
  - si no existe, se usa respaldo inferido desde ingresos para no romper continuidad historica

## Uso Recomendado Del Margen
- Hacer que `Reportes` lea esta vista antes de recalcular margen en frontend.
- Mostrar explicitamente si la produccion viene de:
  - registro formal
  - respaldo por ingresos
- Usar el porcentaje de sectores con `production_records` como indicador de madurez del dato economico.

## Guardas De Integridad Agricola
- Se agrego la migracion `supabase/migrations/20260627133000_add_agricultural_data_integrity_guards.sql`.
- Esta migracion incorpora triggers de validacion para:
  - `income_entries`
  - `production_records`
- Reglas para `income_entries`:
  - `amount`, `quantity_kg`, `amount_usd`, `price_per_kg` y `price_clp_per_kg` no pueden ser negativos
  - `export_percentage` debe estar entre 0 y 100
  - `season` debe coincidir con la fecha agricola real
  - el `field_id` debe pertenecer a la misma empresa
  - el `sector_id` debe pertenecer a la misma empresa
  - si se informa `sector_id`, el `field_id` debe coincidir con el campo de ese sector
  - si se informa `sector_id` y falta `field_id`, el trigger completa el campo automaticamente
- Reglas para `production_records`:
  - `sector_id` debe existir y pertenecer a la empresa indicada
  - `season_year` debe caer en un rango razonable
  - `kg_produced` no puede ser negativo
  - `price_per_kg` no puede ser negativo
- Objetivo:
  - impedir que el margen canónico quede armado con ingresos o producción estructuralmente incoherentes
  - dejar el error lo más cerca posible de la base de datos
  - reducir la necesidad de corregir datos ya contaminados en reportes

## Captura Formal De Produccion
- Se agrego el servicio `src/services/productionRecords.ts`.
- `Reportes` ahora permite:
  - registrar produccion formal por sector y temporada
  - editar produccion cargada
  - eliminar produccion cargada
- La captura se hace dentro de la pestaña de rentabilidad para que la correccion del dato ocurra en el mismo contexto donde se analiza el margen.
- La tabla visible de produccion formal muestra:
  - campo
  - sector
  - hectareas
  - kg producidos
  - precio de referencia por kg
  - estado formal o pendiente

## Alertas De Completitud Economica
- `Reportes` ahora muestra alertas para:
  - sectores con costo sin ingreso
  - sectores con ingreso sin produccion formal
  - sectores con produccion formal sin ingreso
- Objetivo:
  - detectar rapido donde el margen visible aun esta incompleto
  - priorizar regularizacion del dato antes de usarlo como lectura ejecutiva final

## Cierre Economico Ejecutivo
- La vista ejecutiva ahora incorpora una lectura de cierre economico por temporada.
- Esta capa resume:
  - porcentaje de sectores cerrados
  - pendientes de produccion formal
  - pendientes de ingreso
  - costo visible sin cierre comercial
- Esta misma lectura ya se refleja en:
  - pantalla ejecutiva
  - exportacion Excel
  - exportacion PDF
  - presentacion fullscreen ejecutiva
- Objetivo:
  - evitar que el directorio vea solo margen y costo sin entender el nivel real de cierre del dato
  - exponer en el mismo tablero los focos economicos que todavia impiden tomar el margen como definitivo

## Historial De Cierre Del Dato
- `Reportes` ahora incorpora seguimiento historico del cierre economico por temporada.
- Esta capa permite ver:
  - porcentaje de cierre por temporada
  - sectores cerrados
  - pendientes de produccion
  - pendientes de ingreso
  - costo sin ingreso
- Esta misma lectura ya se refleja en:
  - bloque ejecutivo en pantalla
  - exportacion Excel
  - exportacion PDF
  - presentacion fullscreen ejecutiva
- Objetivo:
  - seguir la madurez del dato economico en el tiempo
  - detectar temporadas con brechas persistentes antes de compararlas como si tuvieran la misma calidad

## Cierre Total Del Dato
- `Reportes` ahora incorpora una lectura consolidada de cierre total del dato por temporada.
- Esta capa combina:
  - cierre economico
  - trazabilidad de costo
  - soporte oficial del costo auditado
  - limpieza de focos de revision alta
- Esta misma lectura ya se refleja en:
  - pantalla ejecutiva
  - exportacion Excel
  - exportacion PDF
  - presentacion fullscreen ejecutiva
- Tambien expone un estado directo para presentacion:
  - `Listo para comite`
  - `Listo con advertencias`
  - `No listo para comite`
- Objetivo:
  - evitar que una temporada se presente como definitiva cuando el dato aun esta incompleto
  - resumir en un solo semaforo la calidad real del costo y del margen visible

## Comparacion Entre Empresas Del Cierre Total
- `Reportes` ahora compara la misma temporada entre la empresa activa y otra empresa seleccionada.
- La comparacion ejecutiva ya contrasta:
  - cierre total del dato
  - cierre economico
  - trazabilidad de costo
  - soporte oficial
  - bloqueos visibles
  - estado para comite
- Esta misma lectura ya se refleja en:
  - pantalla ejecutiva
  - exportacion Excel
  - exportacion PDF
- Objetivo:
  - evitar comparar gasto o margen entre empresas con distinta calidad de dato
  - mostrar que empresa esta mas lista para presentacion ejecutiva y donde estan las brechas principales

## Historial Comparado Entre Empresas
- `Reportes` ahora permite seguir el cierre total por temporada entre ambas empresas.
- La lectura historica compara por temporada:
  - cierre total del dato
  - estado para comite
  - bloqueos visibles
  - liderazgo por temporada
  - brecha historica entre empresas
- Esta misma lectura ya se refleja en:
  - pantalla ejecutiva
  - exportacion Excel
  - exportacion PDF
- Objetivo:
  - evitar sacar conclusiones por una sola temporada puntual
  - ver si una empresa mejora, se estanca o retrocede en calidad de dato a traves del tiempo

## Resguardo De Exportacion Ejecutiva
- `Reportes` ahora frena la exportacion ejecutiva cuando la temporada sigue marcada como `No listo para comite`.
- Antes de exportar a:
  - PDF ejecutivo
  - Excel ejecutivo
- La pantalla ahora exige una confirmacion reforzada mostrando:
  - estado para comite
  - cierre total del dato
  - conclusion ejecutiva
  - bloqueos visibles
- Objetivo:
  - evitar circular un reporte como si fuera lectura definitiva cuando la calidad del dato aun no alcanza nivel de comite
  - dejar una trazabilidad explicita de que la exportacion se hizo bajo advertencia

## Presentacion Fullscreen Del Historial Entre Empresas
- La presentacion ejecutiva fullscreen ahora incorpora una capa final para comparar historicamente el cierre total entre empresas.
- El slide muestra:
  - liderazgo historico
  - mejor temporada de cada empresa
  - mayor brecha historica
  - tabla temporada a temporada con brecha y lider
- Objetivo:
  - cerrar la narrativa ejecutiva no solo con la calidad interna del dato, sino tambien con la posicion relativa de cada empresa en el tiempo

## Tendencia Movil Entre Empresas
- `Reportes` ahora calcula una tendencia de mejora o deterioro usando ventana movil de temporadas para cada empresa.
- La tendencia contrasta:
  - promedio reciente de cierre total
  - promedio de la ventana previa
  - delta entre ventanas
  - clasificacion de mejora, estabilidad o deterioro
- Esta lectura ya aparece en:
  - vista ejecutiva
  - exportacion Excel
  - exportacion PDF
  - presentacion fullscreen
- Objetivo:
  - evitar leer el historial solo como una foto estatica
  - mostrar si una empresa realmente esta acelerando, frenando o deteriorando su calidad de dato en el tiempo

## Alerta Preventiva Por Tendencia
- `Reportes` ahora activa una advertencia cuando el cierre puntual de la temporada sigue viendose alto, pero la tendencia movil reciente empeora.
- La alerta aparece en:
  - resumen ejecutivo
  - exportacion Excel
  - exportacion PDF
  - slide fullscreen de cierre total
- Objetivo:
  - evitar una falsa sensacion de control por una sola temporada puntual
  - advertir cuando la calidad del dato empieza a deteriorarse aunque el semaforo actual aun parezca defendible

## Bitacora De Exportacion Bajo Advertencia
- `Reportes` ahora registra una bitacora cuando se exporta el reporte ejecutivo bajo advertencia.
- La bitacora se activa cuando existe al menos una de estas condiciones:
  - temporada `No listo para comite`
  - alerta preventiva por tendencia negativa
- Cada evento guarda:
  - empresa
  - temporada
  - formato exportado (`PDF` o `Excel`)
  - estado para comite
  - cierre total
  - tipos de advertencia
  - contexto ejecutivo y comparativo disponible
- Objetivo:
  - dejar trazabilidad de que un reporte fue exportado pese a advertencias visibles
  - permitir futuras revisiones o auditorias de circulacion del dato ejecutivo

## Recomendacion Ejecutiva Automatica
- `Reportes` ahora emite una recomendacion automatica por empresa para resumir la decision final hacia comite.
- La recomendacion consolida:
  - cierre total del dato
  - bloqueos visibles
  - tendencia movil
  - alerta preventiva por tendencia
  - posicion relativa frente a la empresa comparada
- La salida clasifica cada empresa en:
  - `Presentar a comite`
  - `Presentar con cautela`
  - `No presentar todavia`
- Esta lectura ya aparece en:
  - resumen ejecutivo
  - comparacion entre empresas
  - exportacion Excel
  - exportacion PDF
  - presentacion fullscreen
- Objetivo:
  - cerrar la lectura tecnica con una decision concreta y defendible
  - reducir ambiguedad al momento de presentar el dato a directorio o comite

## Historial De Exportaciones Bajo Advertencia
- `Reportes` ahora carga la bitacora historica de `executive_export_warning_events` para la empresa activa.
- La vista ejecutiva muestra:
  - total de eventos historicos
  - eventos de la temporada visible
  - formato dominante entre PDF y Excel
  - ultima exportacion advertida
  - temporadas mas expuestas
  - advertencias mas frecuentes
  - tabla de ultimos eventos registrados
- La lectura se integra tambien en exportaciones:
  - Excel con hoja `Bitacora Exportaciones`
  - PDF con resumen y ultimos eventos
- La vista ahora admite filtros por:
  - formato de exportacion
  - tipo de advertencia
  - emisor del evento
- Los filtros aplicados gobiernan la lectura visible y tambien la exportacion del bloque historico.
- Objetivo:
  - dejar una pista de auditoria interna sobre circulacion de reportes emitidos con advertencias visibles
  - facilitar revision posterior por temporada, formato y contexto comparativo

## Slide Final De Decision Ejecutiva
- La presentacion fullscreen ejecutiva ahora cierra con un slide final exclusivo para comite.
- Este slide consolida en una sola pantalla:
  - decision ejecutiva final
  - soporte de la decision
  - bloqueos y riesgos a gobernar
  - control de circulacion via bitacora advertida
  - contexto comparado cuando existe otra empresa activa
- La salida busca que la presentacion no termine solo en tablas o metricas, sino en una postura clara de presentacion frente a comite.

## Ranking Automatico Entre Empresas
- `Reportes` ahora calcula un ranking automatico comparado entre empresas.
- El ranking pondera:
  - cierre total del dato 60%
  - tendencia movil 25%
  - disciplina de bloqueos 15%
- La lectura se integra en:
  - vista ejecutiva comparada
  - fullscreen historico entre empresas
  - Excel con hoja `Ranking Empresas`
  - PDF con tabla y conclusion de lider
- Objetivo:
  - dejar una lectura sintetica y defendible de cual empresa llega mejor preparada al comite
  - evitar que la comparacion dependa solo de una lectura manual de tablas separadas

## Trazabilidad De Circulacion Del Reporte
- La exportacion ejecutiva bajo advertencia ahora registra tambien contexto de circulacion.
- Antes de exportar con advertencias visibles, el flujo solicita:
  - destinatario
  - motivo de circulacion
  - nota breve opcional
- Este contexto queda guardado en `executive_export_warning_events` y se expone en:
  - la bitacora visible de `Reportes`
  - Excel en `Bitacora Exportaciones`
  - PDF ejecutivo de auditoria
- Objetivo:
  - distinguir una exportacion tecnica de una circulacion real del reporte
  - dejar evidencia de a quien se compartio el dato y bajo que justificacion

## Filtros De Circulacion En Bitacora
- La bitacora historica ahora puede filtrarse tambien por:
  - destinatario
  - motivo de circulacion
- Estos filtros se suman a los ya existentes de formato, advertencia y emisor.
- La lectura visible se propaga a:
  - KPI de la bitacora
  - resumen de auditoria interna
  - exportacion Excel
  - exportacion PDF
- Objetivo:
  - acotar rapidamente la auditoria a circulaciones especificas
  - revisar que reportes fueron compartidos con un actor o fin determinado

## Agrupacion Historica Por Destinatario
- La bitacora ahora resume tambien la circulacion por destinatario.
- La vista expone:
  - destinatarios mas frecuentes
  - cantidad de eventos por destinatario
  - formatos en que se les circulo informacion
  - ultima fecha visible de circulacion
- La lectura se integra en:
  - vista ejecutiva
  - PDF ejecutivo de auditoria
  - Excel con hoja `Destinatarios Bitacora`
- Objetivo:
  - detectar concentracion de reportes advertidos en ciertos actores
  - facilitar auditoria historica de a quien se comparte mas informacion sensible

## Agrupacion Historica Por Motivo
- La bitacora ahora resume el motivo de circulacion con una lectura mas rica que un simple conteo.
- La vista expone por motivo:
  - cantidad de eventos
  - formatos asociados
  - destinatarios vinculados
  - cantidad de destinatarios alcanzados
  - ultima circulacion visible
- La lectura se integra en:
  - vista ejecutiva
  - PDF ejecutivo de auditoria
  - Excel con hoja `Motivos Bitacora`
- Objetivo:
  - entender para que instancia se comparte mas el reporte bajo advertencia
  - conectar cada motivo con los actores realmente impactados

## Ranking Multiempresa Global Por Temporada
- `Reportes` ahora construye un ranking multiempresa usando todas las empresas accesibles con cierre disponible en la temporada seleccionada.
- El ranking reutiliza la misma logica canonica ya usada en el comparativo entre dos empresas:
  - cierre economico formal
  - trazabilidad y soporte oficial
  - cierre total del dato
  - tendencia movil historica
  - disciplina de bloqueos
- La lectura se integra en:
  - vista ejecutiva normal
  - fullscreen con slide exclusivo
  - Excel con hoja `Ranking Multiempresa`
  - PDF ejecutivo con tabla y lectura de cobertura
- El ranking expone:
  - posicion global por empresa
  - puntaje ponderado
  - cierre total de la temporada
  - tendencia reciente
  - bloqueos visibles
  - estado de comite
  - posicion de la empresa activa dentro del universo
- Objetivo:
  - dejar de comparar solo empresa actual vs empresa comparada
  - mostrar la foto completa del universo empresarial disponible para comite
  - defender con una regla explicita que empresa llega mejor parada a la temporada visible

## Historial Global Y Alertas De Posicion
- El ranking multiempresa ahora tambien expone una lectura historica por temporada para ver rotacion del liderazgo entre empresas.
- La empresa activa se mide contra el cuartil superior del ranking global y genera alerta automatica cuando cae fuera del tramo lider.
- Ademas se detectan rachas consecutivas de rezago, tanto por salida repetida del top cuartil como por ausencia prolongada de liderazgo global.
- La lectura se integra en:
  - vista ejecutiva normal con alerta y tabla historica
  - fullscreen con slide exclusivo de historial global
  - Excel con hojas `Historial Ranking Global`, `Alerta Ranking Global` y `Alerta Consecutiva Global`
  - PDF ejecutivo con bloque historico y recomendacion asociada
- La lectura historica resume:
  - empresa lider por temporada
  - brecha contra el segundo lugar
  - posicion historica de la empresa activa
  - temporadas dentro y fuera del top cuartil
  - liderazgo dominante del universo comparable
  - rachas consecutivas de rezago o falta de liderazgo
- Objetivo:
  - detectar si la empresa actual compite en el tramo alto o queda rezagada frente al universo
  - mostrar si el liderazgo es estable o va rotando entre temporadas
  - reforzar la narrativa de comite con contexto global y no solo bilateral

## Bitacora Persistida De Alertas Globales
- Las alertas globales del ranking multiempresa ahora se persisten en `executive_global_alert_events`.
- La bitacora registra:
  - temporada
  - severidad
  - tipos de alerta activos
  - posicion de la empresa activa
  - corte del top cuartil
  - universo visible de empresas
  - lider de referencia
  - detalle y recomendacion
- `Reportes` ahora expone:
  - total historico de alertas globales persistidas
  - temporada visible con alertas registradas
  - severidad y alerta dominante
  - tabla de eventos recientes
  - cruce temporal entre alerta persistida y exportacion advertida
- La lectura se integra en:
  - vista ejecutiva normal
  - fullscreen historico global
  - Excel con hojas `Historial Alertas Globales` y `Bitacora Alertas Globales`
  - PDF ejecutivo con resumen y ultimos eventos
- Objetivo:
  - auditar cuando aparecieron alertas globales relevantes
  - dejar evidencia de si el riesgo ya existia antes de exportar o circular el reporte
  - sostener trazabilidad formal del deterioro competitivo entre temporadas

## Ciclo De Vida De Alertas Globales
- La bitacora de alertas globales ahora incorpora gestion manual por evento.
- Cada alerta puede quedar en estado:
  - `Pendiente`
  - `Reconocida`
  - `Comunicada`
  - `Cerrada`
- Tambien se registra:
  - responsable visible
  - nota de gestion
  - fecha de actualizacion de la gestion
- `Reportes` ahora permite:
  - filtrar por estado y responsable
  - resumir estados dominantes y responsables frecuentes
  - editar la gestion directamente desde la bitacora
  - exportar hojas separadas por estados y responsables
- Objetivo:
  - distinguir alertas solo detectadas de alertas realmente gestionadas
  - dejar trazabilidad operativa del seguimiento ejecutivo
  - permitir auditoria de quien esta tomando cada alerta y en que estado queda

## Siguiente Paso Recomendado
- Evaluar persistencia historica del ranking global para medir cambios de liderazgo sin recalculo completo en tiempo real.
- Considerar historial formal de transiciones por alerta para saber no solo el estado final, sino todo el recorrido de gestion.
