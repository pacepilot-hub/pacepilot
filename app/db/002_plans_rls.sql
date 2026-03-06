-- 002_plans_rls.sql
-- A executer APRES branchement de l'auth Supabase.

begin;

alter table if exists public.plans enable row level security;

drop policy if exists "Users see own plans" on public.plans;
drop policy if exists "Users insert own plans" on public.plans;
drop policy if exists "Users update own plans" on public.plans;

create policy "Users see own plans"
on public.plans
for select
using (auth.uid() = user_id);

create policy "Users insert own plans"
on public.plans
for insert
with check (auth.uid() = user_id);

create policy "Users update own plans"
on public.plans
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
