import { sql } from "./config/db";
import type { UploadRecord } from "./models/models";

export const createUser = async () => {
  const rows = await sql<{ id: string }[]>`
    insert into users default values
    returning id
  `;

  return rows[0]?.id ?? null;
}

export const getFilesByUserId = async (userId: string) => {
  const rows = await sql<UploadRecord[]>`
  select
  upload_id as file_id,
  original_file_name, 
  content_type, 
  file_size,
  status,
  created_at
  from uploads
  where status = ${"completed"}
  and user_id = ${userId}
  order by created_at desc
  `

  return rows ?? [];
}

export const createUploadRecord = async (userId: string, uploadId: string, objectKey: string, fileName: string, contentType: string, fileSize: number, chunkCount: number, bucketName: string = "files") => {

  const rows = await sql<UploadRecord[]>`
   insert into uploads (
      user_id,
      upload_id,
      object_key,
      original_file_name,
      content_type,
      file_size,
      chunk_count,
      bucket_name,
      status
   ) values (
      ${userId},
      ${uploadId},
      ${objectKey},
      ${fileName},
      ${contentType},
      ${fileSize},
      ${chunkCount},
      ${bucketName},
      ${"initiated"}
    )
      returning *
   `

  return rows[0];
}

export const getUploadByUploadAndUserId = async (userId: string, uploadId: string) => {
  const rows = await sql<UploadRecord[]>`
    select *
    from uploads
    where upload_id = ${uploadId}
    and user_id = ${userId}
    limit 1
  `;

  return rows[0] ?? null;
}

export const markUploadCompleted = async (userId: string, uploadId: string, etag: string) => {

  const rows = await sql<UploadRecord[]>`
    update uploads set  status = ${"completed"},
      etag = ${etag},
      completed_at = now(),
      error_reason = null
    where upload_id = ${uploadId}
    and user_id = ${userId}
    returning *
  `;
  return rows[0] ?? null;
}

export const markUploadAborted = async (userId: string, uploadId: string) => {
  const rows = await sql<UploadRecord[]>`
    update uploads
    set
      status = ${"aborted"},
      error_reason = null
    where upload_id = ${uploadId}
    and user_id = ${userId}
    returning *
  `;

  return rows[0] ?? null;
}

export const markUploadFailed = async (userId: string, uploadId: string, reason: string) => {
  const rows = await sql<UploadRecord[]>`
    update uploads
    set
      status = ${"failed"},
      error_reason = ${reason}
    where upload_id = ${uploadId}
    and user_id = ${userId}
    returning *
  `;

  return rows[0] ?? null;
}

export const setErrorReason = async (userId: string, uploadId: string, reason: string) => {
  const rows = await sql<UploadRecord[]>`
    update uploads
    set
      error_reason = ${reason}
    where upload_id = ${uploadId}
    and user_id = ${userId}
    returning *
  `;

  return rows[0] ?? null;
}

export const getStaleUploads = async (age: number) => {
  const cutOff = new Date(Date.now() - age);

  return await sql<UploadRecord[]>`
  select * from uploads
  where status = ${"initiated"}
    and created_at < ${cutOff.toISOString()}
  `;
}

export const markUploadForDeletion = async (userId: string, uploadIds: string[]) => {

  const rows = await sql<{upload_id: string}[]>`
  update uploads 
  set status = ${"pending_delete"}
  where upload_id = any(${uploadIds})
  and status = ${"completed"}
  and user_id = ${userId}
  returning upload_id
  `

  return rows ?? [];
}

export const getMarkedForDelete = async () => {
  const rows = await sql<UploadRecord[]>`
  select * from uploads where status = ${"pending_delete"}`

  return rows ?? [];
}

export const setUploadsDeleted = async (uploadIds: string[]) => {
  const rows = await sql<{ upload_id: string }[]>`
   update uploads
  set status = ${"deleted"},
      error_reason = null
  where upload_id = any(${uploadIds})
  and status = ${"pending_delete"}
  returning upload_id`

  return rows ?? [];
}