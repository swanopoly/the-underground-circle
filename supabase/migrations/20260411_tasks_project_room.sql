alter table tasks
  add column if not exists room_id uuid references project_rooms(id) on delete set null;

create index if not exists idx_tasks_room_id on tasks(room_id);

notify pgrst, 'reload schema';
