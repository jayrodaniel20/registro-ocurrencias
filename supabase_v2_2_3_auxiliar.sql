-- SAGE V2.2.3 - Rol Auxiliar de educación
-- Ejecutar una sola vez en Supabase SQL Editor antes de usar el rol Auxiliar.

-- 1) Ampliar la validación de roles de user_memberships para aceptar 'auxiliar'.
-- Se elimina la restricción CHECK anterior (el nombre usual generado por PostgreSQL).
alter table public.user_memberships
  drop constraint if exists user_memberships_role_check;

alter table public.user_memberships
  add constraint user_memberships_role_check
  check (role in (
    'admin_general',
    'especialista_ugel',
    'director',
    'docente',
    'auxiliar'
  ));

-- 2) Docentes y auxiliares pueden crear/modificar sus propios registros.
-- Un Director sin rol Docente/Auxiliar continúa en modo solo lectura.
create or replace function public.can_write_teacher_records()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_admin_general()
  or exists (
    select 1
    from public.user_memberships m
    where m.user_id = auth.uid()
      and m.role in ('docente','auxiliar')
      and m.active = true
      and (m.valid_until is null or m.valid_until > now())
  )
  or not exists (
    select 1
    from public.user_memberships m
    where m.user_id = auth.uid()
      and m.role = 'director'
      and m.active = true
      and (m.valid_until is null or m.valid_until > now())
  );
$$;

-- 3) Índice de apoyo (seguro si ya existe).
create index if not exists idx_user_memberships_user_active
on public.user_memberships(user_id, active);
