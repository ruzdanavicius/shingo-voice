-- Shingo Voice schema. Run once in the Supabase SQL Editor of a fresh project.

create table principles (
  id serial primary key,
  title text not null,
  summary text not null,
  sort_order int not null default 0
);

insert into principles (title, summary, sort_order) values
('Respect Every Individual', 'Everyone deserves respect, purpose, and a real chance to contribute their thinking, not just their hands.', 1),
('Lead with Humility', 'Leaders grow by seeking out feedback and admitting they do not have every answer.', 2),
('Seek Perfection', 'Treat "good enough" as temporary; keep chasing the ideal state one small improvement at a time.', 3),
('Embrace Scientific Thinking', 'Improvement comes from structured experiments — hypothesis, test, learn — not from guessing.', 4),
('Focus on Process', 'When results disappoint, examine and improve the process behind them instead of blaming people.', 5),
('Assure Quality at the Source', 'Build quality checks into the work itself so problems are caught and fixed where they happen.', 6),
('Improve Flow & Pull Value', 'Organize work so value moves smoothly to the customer, pulled by real demand instead of pushed by forecasts.', 7),
('Think Systemically', 'Understand how a change in one part of the system ripples into the rest before you make it.', 8),
('Create Constancy of Purpose', 'Keep everyone aligned on a clear, stable purpose so daily decisions add up to real progress.', 9),
('Create Value for the Customer', 'Start from what the customer actually values and work backward to how the organization delivers it.', 10);

create table page_views (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id text not null,
  principle_id int references principles(id)
);

create table responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id text not null,
  principle_id int not null references principles(id),
  response_text text not null check (char_length(response_text) between 1 and 4000),
  score int not null check (score between 0 and 100),
  panel jsonb not null
);

create index page_views_created_at_idx on page_views (created_at);
create index responses_created_at_idx on responses (created_at);
create index responses_principle_id_idx on responses (principle_id);

alter table principles enable row level security;
alter table page_views enable row level security;
alter table responses enable row level security;

create policy "principles are publicly readable" on principles
  for select using (true);

create policy "anyone can log a page view" on page_views
  for insert with check (true);

create policy "anyone can submit a response" on responses
  for insert with check (true);

-- Definer views are intentional: they are the only read path for the public key.
-- No session_id and no raw text; review_feed exposes a 150-char excerpt only.
create view analytics_events
with (security_invoker = false) as
select created_at, principle_id, 'view'::text as kind, null::int as score
from page_views
union all
select created_at, principle_id, 'response'::text as kind, score
from responses;

create view review_feed
with (security_invoker = false) as
select id, created_at, principle_id, left(response_text, 150) as response_excerpt, score
from responses
order by created_at desc
limit 200;

grant usage on schema public to anon, authenticated;
grant select on principles to anon, authenticated;
grant insert on page_views to anon, authenticated;
grant insert on responses to anon, authenticated;
grant select on analytics_events to anon, authenticated;
grant select on review_feed to anon, authenticated;
