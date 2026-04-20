alter table uploads
drop constraint if exists uploads_status_check;

alter table uploads
add constraint uploads_status_check
check (
  status in (
    'initiated',
    'completed',
    'aborted',
    'failed',
    'pending_delete',
    'deleted'
  )
);