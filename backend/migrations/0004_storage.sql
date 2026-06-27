-- ============================================================================
-- CAR WASH SERVICES — Migración 0004: Storage de fotos (Fase 8)
-- Bucket PRIVADO 'ordenes-fotos'. El frontend muestra las fotos con URLs firmadas.
-- Pegar en SQL Editor -> Run.
-- ============================================================================

begin;

-- Bucket privado (public = false).
insert into storage.buckets (id, name, public)
values ('ordenes-fotos', 'ordenes-fotos', false)
on conflict (id) do nothing;

-- Las fotos se guardan en la ruta "{uid}/archivo". El staff ve/gestiona todas;
-- un empleado solo las suyas (primer segmento del path = su uid).
drop policy if exists "fotos_leer" on storage.objects;
create policy "fotos_leer" on storage.objects for select to authenticated
  using (
    bucket_id = 'ordenes-fotos'
    and (public.is_staff() or (storage.foldername(name))[1] = auth.uid()::text)
  );

drop policy if exists "fotos_subir" on storage.objects;
create policy "fotos_subir" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ordenes-fotos'
    and (public.is_staff() or (storage.foldername(name))[1] = auth.uid()::text)
  );

-- Solo staff (admin/super_admin) puede actualizar o borrar fotos.
drop policy if exists "fotos_actualizar" on storage.objects;
create policy "fotos_actualizar" on storage.objects for update to authenticated
  using (bucket_id = 'ordenes-fotos' and public.is_staff())
  with check (bucket_id = 'ordenes-fotos' and public.is_staff());

drop policy if exists "fotos_borrar" on storage.objects;
create policy "fotos_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'ordenes-fotos' and public.is_staff());

commit;
