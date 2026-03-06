-- 002_plans_rls.sql
-- A executer APRES branchement de l'auth Supabase.

begin;

alter table if exists public.plans enable row level security;

-- Remplacement idempotent de la policy.
drop policy if exists "Users see own plans" on public.plans;

create policy "Users see own plans"
on public.plans
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
