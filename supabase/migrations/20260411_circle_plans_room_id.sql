alter table circle_plans
  add column if not exists room_id uuid references project_rooms(id) on delete set null;

create index if not exists idx_circle_plans_room_id on circle_plans(room_id);

notify pgrst, 'reload schema';
