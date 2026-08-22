-- ContentFlow — ตั้งค่าตารางฐานข้อมูลกลางสำหรับซิงก์ข้ามอุปกรณ์
-- รันทั้งไฟล์นี้ใน Supabase Dashboard > SQL Editor > New query > Run

create table if not exists contentflow_data (
  id text primary key default 'main',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into contentflow_data (id, payload)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

create or replace function contentflow_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_contentflow_data_updated_at on contentflow_data;
create trigger trg_contentflow_data_updated_at
before update on contentflow_data
for each row execute function contentflow_set_updated_at();

alter table contentflow_data enable row level security;

drop policy if exists "contentflow anon select" on contentflow_data;
create policy "contentflow anon select" on contentflow_data
  for select using (true);

drop policy if exists "contentflow anon update" on contentflow_data;
create policy "contentflow anon update" on contentflow_data
  for update using (true) with check (true);

drop policy if exists "contentflow anon insert" on contentflow_data;
create policy "contentflow anon insert" on contentflow_data
  for insert with check (true);
