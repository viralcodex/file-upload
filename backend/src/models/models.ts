export interface UploadRecord {
  user_id: string;
  upload_id: string;
  object_key: string;
  original_file_name: string;
  content_type: string;
  file_size: string;
  chunk_count: string;
  status: 'initiated' | 'completed' | 'aborted' | 'failed' | 'pending_delete' | 'deleted';
  etag: string | null;
  error_reason: string | null;
  created_at: string;
  completed_at: string | null;
}
