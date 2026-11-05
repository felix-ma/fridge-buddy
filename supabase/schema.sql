-- fridge-buddy · Supabase 建表 / 约束 / RLS
-- 在 Supabase SQL Editor 里整段执行。只存结构化文本，不存任何图片。

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 用户：微信 openid → 内部 uuid，其余表只认 uuid，不散落 openid
-- ---------------------------------------------------------------------------
create table if not exists public.app_users (
  id          uuid primary key default gen_random_uuid(),
  openid      text not null unique,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 观测：每次拍摄会话一条，只增不改（触发器中强制）
-- ---------------------------------------------------------------------------
create table if not exists public.observations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.app_users (id) on delete cascade,
  session_id   text not null,
  captured_at  timestamptz not null default now(),
  zone_hint    text,
  items_json   jsonb not null default '[]'::jsonb,
  uncertain_json jsonb not null default '[]'::jsonb,
  meta         jsonb not null default '{}'::jsonb,   -- model / tokens / 耗时
  created_at   timestamptz not null default now()
);
create index if not exists observations_user_time_idx
  on public.observations (user_id, captured_at desc);

create or replace function public.observations_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'observations 只增不改：请插入新记录，不要修改历史观测';
end;
$$;

drop trigger if exists observations_no_update on public.observations;
create trigger observations_no_update
  before update or delete on public.observations
  for each row execute function public.observations_append_only();

-- ---------------------------------------------------------------------------
-- 库存：由状态机推断出的实体
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.app_users (id) on delete cascade,
  label           text not null,
  quantity        int  not null default 1 check (quantity >= 0),
  zone_id         text,
  state           text not null default 'present'
                    check (state in ('present', 'probably_removed', 'removed', 'consumed')),
  confidence      numeric(3,2) not null default 0.60 check (confidence >= 0 and confidence <= 1),
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  miss_count      int not null default 0 check (miss_count >= 0),
  shelf_life_days int check (shelf_life_days between 0 and 3650),
  expire_at       timestamptz,
  pending_quantity int check (pending_quantity is null or pending_quantity > 0),
  updated_at      timestamptz not null default now()
);
create index if not exists inventory_user_state_idx
  on public.inventory_items (user_id, state);
create index if not exists inventory_expire_idx
  on public.inventory_items (expire_at) where state in ('present', 'probably_removed');
-- 同一用户同一名称只保留一个活跃实体，从数据库层杜绝重复行
create unique index if not exists inventory_active_label_uniq
  on public.inventory_items (user_id, lower(label))
  where state in ('present', 'probably_removed');

-- ---------------------------------------------------------------------------
-- Provider 配置：Key 只以密文形式存在
-- ---------------------------------------------------------------------------
create table if not exists public.user_provider_configs (
  user_id        uuid primary key references public.app_users (id) on delete cascade,
  base_url       text not null default 'https://api.deepseek.com',
  model_name     text not null default 'deepseek-flash',
  encrypted_key  text,
  key_hint       text,          -- 仅存末四位用于界面展示，如 "sk-…a1b2"
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 提醒发送记录：同一天同一食材不重复推送订阅消息
-- ---------------------------------------------------------------------------
create table if not exists public.reminder_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.app_users (id) on delete cascade,
  item_id    uuid references public.inventory_items (id) on delete cascade,
  level      text not null,
  sent_date  date not null default current_date,
  created_at timestamptz not null default now(),
  unique (user_id, item_id, level, sent_date)
);

-- ---------------------------------------------------------------------------
-- RLS：客户端不直连数据库，只有云函数的 service_role 能读写
-- （service_role 绕过 RLS；anon / authenticated 一律拒绝，防止 anon key 泄漏后越权）
-- ---------------------------------------------------------------------------
alter table public.app_users            enable row level security;
alter table public.observations          enable row level security;
alter table public.inventory_items       enable row level security;
alter table public.user_provider_configs enable row level security;
alter table public.reminder_logs         enable row level security;

revoke all on public.app_users            from anon, authenticated;
revoke all on public.observations          from anon, authenticated;
revoke all on public.inventory_items       from anon, authenticated;
revoke all on public.user_provider_configs from anon, authenticated;
revoke all on public.reminder_logs         from anon, authenticated;
