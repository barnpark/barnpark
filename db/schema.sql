-- ============================================================
-- easyBooking · Supabase schema (multi-tenant)
-- Run this ONCE in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists hotels (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  location    text,
  phone       text,
  line_id     text,
  currency    text default '฿',
  brand_color text default '#4f7d6e',     -- hotel's own theme colour (booking page + app accent)
  tagline     text,                       -- short line shown on the booking page hero
  status      text default 'active',      -- active | onboarding | paused
  plan_fee    numeric default 800,        -- ฿/month
  created_at  timestamptz default now()
);

-- migrate existing databases (safe to run repeatedly)
alter table hotels add column if not exists brand_color text default '#4f7d6e';
alter table hotels add column if not exists tagline text;
alter table hotels add column if not exists cover_url text;    -- hero background image on the booking page
alter table hotels add column if not exists about text;        -- "about the property" paragraph
alter table hotels add column if not exists promo_text text;   -- promotion banner text
alter table hotels add column if not exists promo_image text;  -- promotion banner image
alter table hotels add column if not exists notify_email text; -- where the hotel receives new-booking notifications

-- profiles link an auth user to one hotel + a role.
-- role: 'owner' / 'staff' (a hotel), or 'admin' (platform owner, sees all).
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  hotel_id   uuid references hotels(id) on delete set null,
  role       text not null default 'staff' check (role in ('owner','staff','admin')),
  full_name  text,
  created_at timestamptz default now()
);

create table if not exists room_types (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,
  name       text not null,
  capacity   int  default 2,
  qty        int  default 1,             -- how many physical rooms of this type
  base_price numeric default 0,          -- direct price / night
  ota_price  numeric default 0,          -- indicative OTA price (for "save" badge)
  sort       int  default 0,
  image_url  text,                        -- room photo shown on the booking page
  extra_bed_price numeric default 0,      -- price per extra bed / night (0 = ไม่มีเตียงเสริม)
  created_at timestamptz default now()
);
alter table room_types add column if not exists image_url text;
alter table room_types add column if not exists extra_bed_price numeric default 0;

-- extra services shown on the booking page (นวด/สปา/อาหารเช้า/กิจกรรม ฯลฯ)
create table if not exists services (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  name        text not null,
  description text,
  price       numeric,
  image_url   text,
  sort        int default 0,
  created_at  timestamptz default now()
);
create index if not exists idx_services_hotel on services(hotel_id);

create table if not exists bookings (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_type_id  uuid references room_types(id) on delete set null,
  room_no       int,
  guest_name    text,
  guest_tel     text,
  guest_email   text,
  channel       text default 'direct',   -- direct | walkin | phone | line | agoda | booking | trip | other
  checkin       date not null,
  checkout      date not null,
  pax           int  default 1,
  amount        numeric default 0,
  status        text default 'confirmed' check (status in ('confirmed','pending','cancelled')),
  note          text,
  ext_uid       text,                     -- external OTA confirmation id (future channel sync)
  notify_channel text default 'email',    -- how the guest wants confirmations: email | sms | line | none
  line_user_id  text,                     -- LINE userId (only if guest added the OA / booked via LINE)
  extra_bed     int default 0,            -- extra beds on this room
  created_at    timestamptz default now()
);
alter table bookings add column if not exists notify_channel text default 'email';
alter table bookings add column if not exists line_user_id text;
alter table bookings add column if not exists extra_bed int default 0;

create index if not exists idx_bookings_hotel  on bookings(hotel_id);
create index if not exists idx_bookings_dates   on bookings(hotel_id, checkin, checkout);
create index if not exists idx_roomtypes_hotel  on room_types(hotel_id);

-- ---------- helper functions ----------
create or replace function my_hotel() returns uuid
  language sql stable security definer set search_path = public as
$$ select hotel_id from profiles where id = auth.uid() $$;

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles where id = auth.uid() and role = 'admin') $$;

-- ---------- RLS ----------
alter table hotels      enable row level security;
alter table profiles    enable row level security;
alter table room_types  enable row level security;
alter table bookings    enable row level security;
alter table services    enable row level security;

-- hotels: anon can read basic info (needed by the public booking page);
--         staff read their own; admin reads all; only admin writes.
drop policy if exists hotels_read_public on hotels;
create policy hotels_read_public on hotels for select using (true);
drop policy if exists hotels_write_admin on hotels;
create policy hotels_write_admin on hotels for all
  using (is_admin()) with check (is_admin());

-- profiles: a user reads/updates own row; admin reads all.
drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for select using (id = auth.uid() or is_admin());
drop policy if exists profiles_self_upd on profiles;
create policy profiles_self_upd on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- room_types: anon can read (public menu/prices); staff of the hotel + admin manage.
drop policy if exists rt_read_public on room_types;
create policy rt_read_public on room_types for select using (true);
drop policy if exists rt_write on room_types;
create policy rt_write on room_types for all
  using (hotel_id = my_hotel() or is_admin())
  with check (hotel_id = my_hotel() or is_admin());

-- bookings: staff of the hotel + admin have full access; NO anon select
-- (guest data stays private). Public bookings are created via RPC below.
drop policy if exists bk_staff on bookings;
create policy bk_staff on bookings for all
  using (hotel_id = my_hotel() or is_admin())
  with check (hotel_id = my_hotel() or is_admin());

-- services: anon can read (public page); hotel staff + admin manage.
drop policy if exists sv_read_public on services;
create policy sv_read_public on services for select using (true);
drop policy if exists sv_write on services;
create policy sv_write on services for all
  using (hotel_id = my_hotel() or is_admin())
  with check (hotel_id = my_hotel() or is_admin());

-- ---------- Storage (image uploads) ----------
-- public bucket for hotel photos (cover / room / promo / service images)
insert into storage.buckets (id, name, public)
  values ('hotel-media','hotel-media', true)
  on conflict (id) do nothing;

drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects for select
  using (bucket_id = 'hotel-media');
drop policy if exists media_write on storage.objects;
create policy media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'hotel-media');
drop policy if exists media_update on storage.objects;
create policy media_update on storage.objects for update to authenticated
  using (bucket_id = 'hotel-media');
drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hotel-media');

-- ---------- public RPCs (security definer = bypass RLS in a controlled way) ----------

-- Availability for the public booking page: returns only counts, never guest data.
drop function if exists get_availability(text, date, date);
create or replace function get_availability(p_slug text, p_in date, p_out date)
returns table(room_type_id uuid, name text, capacity int, base_price numeric,
              ota_price numeric, qty int, image_url text, extra_bed_price numeric, booked int, available int)
language sql stable security definer set search_path = public as
$$
  with h as (select id from hotels where slug = p_slug)
  select rt.id, rt.name, rt.capacity, rt.base_price, rt.ota_price, rt.qty, rt.image_url, coalesce(rt.extra_bed_price,0),
         coalesce(cnt.b,0) as booked,
         greatest(rt.qty - coalesce(cnt.b,0), 0) as available
  from room_types rt
  join h on h.id = rt.hotel_id
  left join lateral (
     select count(*)::int b from bookings bk
     where bk.room_type_id = rt.id
       and bk.status <> 'cancelled'
       and bk.checkin < p_out and bk.checkout > p_in     -- date-range overlap
  ) cnt on true
  order by rt.sort, rt.name;
$$;

-- Create a booking from the public page. Validates availability server-side.
-- Supports booking several rooms at once + extra beds per room.
drop function if exists create_public_booking(text,uuid,date,date,text,text,text,int,text,text,text,text);
create or replace function create_public_booking(
  p_slug text, p_room_type uuid, p_in date, p_out date,
  p_name text, p_tel text, p_email text, p_pax int, p_note text, p_channel text default 'direct',
  p_notify text default 'email', p_line_user text default null,
  p_rooms int default 1, p_extra_bed int default 0)
returns table(booking_id uuid, ref text, amount numeric)
language plpgsql security definer set search_path = public as
$$
declare v_hotel uuid; v_qty int; v_booked int; v_price numeric; v_eb numeric;
        v_nights int; v_per numeric; v_rooms int; v_id uuid; v_first uuid; i int;
begin
  select id into v_hotel from hotels where slug = p_slug;
  if v_hotel is null then raise exception 'hotel not found'; end if;
  if p_out <= p_in then raise exception 'invalid dates'; end if;
  v_rooms := greatest(1, coalesce(p_rooms,1));

  select qty, base_price, coalesce(extra_bed_price,0) into v_qty, v_price, v_eb
    from room_types where id = p_room_type and hotel_id = v_hotel;
  if v_qty is null then raise exception 'room type not found'; end if;

  select count(*) into v_booked from bookings
   where room_type_id = p_room_type and status <> 'cancelled'
     and checkin < p_out and checkout > p_in;
  if v_booked + v_rooms > v_qty then raise exception 'no availability'; end if;

  v_nights := (p_out - p_in);
  v_per := (v_price + coalesce(p_extra_bed,0) * v_eb) * v_nights;   -- ต่อ 1 ห้อง

  for i in 1..v_rooms loop
    insert into bookings(hotel_id, room_type_id, guest_name, guest_tel, guest_email,
                         channel, checkin, checkout, pax, amount, status, note,
                         notify_channel, line_user_id, extra_bed)
    values (v_hotel, p_room_type, p_name, p_tel, nullif(p_email,''),
            coalesce(nullif(p_channel,''),'direct'), p_in, p_out, coalesce(p_pax,1), v_per, 'confirmed', p_note,
            coalesce(nullif(p_notify,''),'email'), nullif(p_line_user,''), coalesce(p_extra_bed,0))
    returning id into v_id;
    if i = 1 then v_first := v_id; end if;
  end loop;

  return query select v_first, 'BP-'||to_char(now(),'YYMMDD')||'-'||upper(substr(v_first::text,1,4)), v_per * v_rooms;
end;
$$;

-- allow the anonymous (public booking page) and logged-in users to call the RPCs
grant execute on function get_availability(text,date,date)                                   to anon, authenticated;
grant execute on function create_public_booking(text,uuid,date,date,text,text,text,int,text,text,text,text,int,int) to anon, authenticated;

-- ============================================================
-- FIRST-TIME SETUP (do these AFTER creating your login in Authentication → Users)
-- ------------------------------------------------------------
-- 1) Create the platform-owner (admin) profile. Replace the email with yours:
--    insert into profiles (id, role, full_name)
--    select id, 'admin', 'Platform Owner' from auth.users where email = 'you@example.com'
--    on conflict (id) do update set role = 'admin';
--
-- 2) Create a demo hotel + its owner login (create the auth user first, then):
--    insert into hotels (slug,name,location,phone,line_id)
--      values ('yhabitat','เดอะ วาย ฮาบิแทท','กาญจนบุรี','034-000-000','@yhabitat');
--    insert into profiles (id, hotel_id, role, full_name)
--      select u.id, h.id, 'owner', 'เจ้าของโรงแรม'
--      from auth.users u, hotels h
--      where u.email = 'hotel@example.com' and h.slug = 'yhabitat'
--      on conflict (id) do update set hotel_id = excluded.hotel_id, role = 'owner';
--
-- 3) Seed room types for that hotel:
--    insert into room_types (hotel_id,name,capacity,qty,base_price,ota_price,sort)
--    select id,'ห้อง Standard',2,4,900,1050,1 from hotels where slug='yhabitat'
--    union all select id,'ห้อง Deluxe',2,4,1200,1400,2 from hotels where slug='yhabitat'
--    union all select id,'ห้อง Suite ริมน้ำ',4,2,1800,2100,3 from hotels where slug='yhabitat';
-- ============================================================
