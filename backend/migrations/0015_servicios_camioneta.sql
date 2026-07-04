-- ============================================================================
-- CAR WASH SERVICES — Migración 0015: Paquetes de lavado para CAMIONETAS
-- Las camionetas solo tenían los servicios de la categoría "Otros"; faltaban
-- los paquetes (Sencilla → Premium Plus) que sí existen para autos/motos.
-- Precios y descripciones según el tarifario "TARIFAS UNICAS · CAMIONETAS".
-- Idempotente: ON CONFLICT por la clave natural (nombre, tipo_vehiculo).
-- ============================================================================

begin;

insert into public.servicios (categoria, nombre, descripcion, tipo_vehiculo, precio) values
  ('Camionetas', 'Sencilla',
    'Alistada de interior, exterior y emulsión impermeabilizante para llantas',
    'camioneta', 39000),
  ('Camionetas', 'Plus',
    'Alistada de interior, exterior y emulsión impermeabilizante para llantas, partes negras externas más estribos',
    'camioneta', 58000),
  ('Camionetas', 'Máster',
    'Alistada de interior, exterior y emulsión impermeabilizante para llantas, partes negras externas más estribos y restaurada de partes negras internas',
    'camioneta', 75000),
  ('Camionetas', 'Máster Plus',
    'Alistada de interior, exterior y emulsión impermeabilizante para llantas, partes negras externas más estribos y restaurada de partes negras internas más chasis motor',
    'camioneta', 137000),
  ('Camionetas', 'Premium',
    'Alistada de interior, exterior y emulsión impermeabilizante para llantas, partes negras externas más estribos y restaurada de partes negras internas incluyendo chasis y motor',
    'camioneta', 197000),
  ('Camionetas', 'Premium Plus',
    'Alistada de interior, exterior y emulsión impermeabilizante para llantas, partes negras externas más estribos, restaurada de partes negras internas incluyendo chasis y motor más brillada con máquina',
    'camioneta', 345000)
on conflict (nombre, tipo_vehiculo) do nothing;

commit;
