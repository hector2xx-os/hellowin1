-- ============================================================
-- Base de datos de la fiesta. Pégalo completo en Supabase:
-- SQL Editor > New query > pegar > Run
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- 1) Tablas
create table if not exists public.invitados (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,
  telefono  text,
  precio    integer not null check (precio in (150, 180, 200)),
  codigo    text not null unique,
  usado     boolean not null default false,
  usado_en  timestamptz,
  creado    timestamptz not null default now()
);

-- Aquí vive el secreto que firma los QR. Nadie puede leerla desde la página.
create table if not exists public.config (
  clave text primary key,
  valor text not null
);
insert into public.config (clave, valor)
values ('secreto_qr', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (clave) do nothing;

-- 2) Seguridad por filas: solo administradores con sesión
alter table public.invitados enable row level security;
alter table public.config    enable row level security;   -- sin políticas = cerrada

drop policy if exists "admin lee invitados"  on public.invitados;
drop policy if exists "admin borra invitados" on public.invitados;
create policy "admin lee invitados"   on public.invitados for select to authenticated using (true);
create policy "admin borra invitados" on public.invitados for delete to authenticated using (true);

revoke all on public.config from anon, authenticated;
revoke insert, update on public.invitados from anon, authenticated;
revoke all on public.invitados from anon;
grant select, delete on public.invitados to authenticated;

-- 3) Funciones (se ejecutan en el servidor)
create or replace function public.firmar(p_id text) returns text
language sql security definer set search_path = public, extensions as $$
  select substr(encode(hmac(p_id, (select valor from public.config where clave = 'secreto_qr'), 'sha256'), 'hex'), 1, 12)
$$;

create or replace function public.crear_invitado(p_nombre text, p_telefono text, p_precio integer)
returns public.invitados
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id text;
  v_row public.invitados;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'El nombre es obligatorio'; end if;
  v_id := upper(encode(gen_random_bytes(5), 'hex'));
  insert into public.invitados (nombre, telefono, precio, codigo)
  values (trim(p_nombre), nullif(trim(coalesce(p_telefono, '')), ''), p_precio,
          'HLW-' || v_id || '.' || public.firmar(v_id))
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.validar_boleto(p_codigo text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  g public.invitados;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  if p_codigo is null or p_codigo !~ '^HLW-[0-9A-F]{10}\.[0-9a-f]{12}$' then
    return json_build_object('tipo', 'falso', 'msg', 'El código no tiene el formato de un boleto de esta fiesta.');
  end if;
  if public.firmar(substr(p_codigo, 5, 10)) <> substr(p_codigo, 16, 12) then
    return json_build_object('tipo', 'falso', 'msg', 'La firma no coincide: el código fue alterado o inventado.');
  end if;
  select * into g from public.invitados where codigo = p_codigo;
  if not found then
    return json_build_object('tipo', 'falso', 'msg', 'La firma es correcta pero el boleto no existe en la base de datos.');
  end if;
  if g.usado then
    return json_build_object('tipo', 'usado', 'id', g.id, 'nombre', g.nombre,
      'msg', g.nombre || ' ya entró el ' || to_char(g.usado_en at time zone 'America/Mexico_City', 'DD/MM/YYYY HH24:MI') || '. Posible boleto duplicado.');
  end if;
  return json_build_object('tipo', 'valido', 'id', g.id, 'nombre', g.nombre, 'precio', g.precio,
    'msg', 'Boleto de ' || g.nombre || ' ($' || g.precio || ').');
end $$;

create or replace function public.registrar_entrada(p_id uuid) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  g public.invitados;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  -- El "and usado = false" evita que dos celulares registren el mismo boleto a la vez
  update public.invitados set usado = true, usado_en = now()
   where id = p_id and usado = false
  returning * into g;
  if found then
    return json_build_object('tipo', 'entrada', 'nombre', g.nombre,
      'msg', g.nombre || ' quedó registrado como asistente.');
  end if;
  select * into g from public.invitados where id = p_id;
  if not found then
    return json_build_object('tipo', 'falso', 'msg', 'El boleto ya no existe.');
  end if;
  return json_build_object('tipo', 'usado', 'nombre', g.nombre,
    'msg', g.nombre || ' ya había entrado el ' || to_char(g.usado_en at time zone 'America/Mexico_City', 'DD/MM/YYYY HH24:MI') || '.');
end $$;

-- 4) Permisos: solo usuarios con sesión pueden llamar las funciones
revoke execute on function public.firmar(text) from public, anon, authenticated;
revoke execute on function public.crear_invitado(text, text, integer) from public, anon;
revoke execute on function public.validar_boleto(text) from public, anon;
revoke execute on function public.registrar_entrada(uuid) from public, anon;
grant execute on function public.crear_invitado(text, text, integer) to authenticated;
grant execute on function public.validar_boleto(text) to authenticated;
grant execute on function public.registrar_entrada(uuid) to authenticated;
