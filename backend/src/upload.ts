import { sql } from "./config/db";
import type { UploadRecord } from "./models/models";

export const getFiles = async () => {
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
  order by created_at desc
  `

  return rows ?? [];
}

export const createUploadRecord = async (uploadId: string, objectKey: string, fileName: string, contentType: string, fileSize: number, chunkCount: number, bucketName: string = "files") => {

  const rows = await sql<UploadRecord[]>`
   insert into uploads (
      upload_id,
      object_key,
      original_file_name,
      content_type,
      file_size,
      chunk_count,
      bucket_name,
      status
   ) values (
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

export const getUploadByUploadId = async (uploadId: string) => {
  const rows = await sql<UploadRecord[]>`
    select *
    from uploads
    where upload_id = ${uploadId}
    limit 1
  `;

  return rows[0] ?? null;
}

export const markUploadCompleted = async (uploadId: string, etag: string) => {

  const rows = await sql<UploadRecord[]>`
    update uploads set  status = ${"completed"},
      etag = ${etag},
      completed_at = now(),
      error_reason = null
    where upload_id = ${uploadId}
    returning *
  `;
  return rows[0] ?? null;
}

export const markUploadAborted = async (uploadId: string, objectKey: string) => {
  const rows = await sql<UploadRecord[]>`
    update uploads
    set
      status = ${"aborted"},
      error_reason = null
    where upload_id = ${uploadId}
    returning *
  `;

  return rows[0] ?? null;
}

export const markUploadFailed = async (uploadId: string, reason: string) => {
  const rows = await sql<UploadRecord[]>`
    update uploads
    set
      status = ${"failed"},
      error_reason = ${reason}
    where upload_id = ${uploadId}
    returning *
  `;

  return rows[0] ?? null;
}

export const setErrorReason = async (uploadId: string, reason: string) => {
  const rows = await sql<UploadRecord[]>`
    update uploads
    set
      error_reason = ${reason}
    where upload_id = ${uploadId}
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

export const markUploadForDeletion = async (uploadIds: string[]) => {

  const rows = await sql<{upload_id: string}[]>`
  update uploads 
  set status = ${"pending_delete"}
  where upload_id = any(${uploadIds})
  and status = ${"completed"}
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