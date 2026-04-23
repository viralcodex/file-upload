export type UploadStatus = "uploading" | "paused" | "complete" | "error";

export interface DeleteFilesResponse {
    status: "ok" | "partial";
    markedIds: string[];
    skippedIds: string[];
};

export interface FileEntry {
    id: string;
    fileName: string;
    fileSize: number;
    contentType: string;
    status: UploadStatus;
    statusText: string;
    uploadId?: string;
    selected: boolean;
};

export interface UploadedPart {
    part: number;
    etag?: string;
};

export interface UploadTarget {
    part: number;
    url: string;
    chunk: Blob;
};

export interface ResumeUploadResponse {
    uploadId: string;
    uploadedParts: UploadedPart[];
    remainingParts: { part: number; url: string }[];
};

export interface ErrorResponse {
    error?: string;
    reason?: string;
    status?: string;
};

export interface ServerFileEntry {
    file_id: FileEntry["id"];
    original_file_name: FileEntry["fileName"];
    content_type: FileEntry["contentType"];
    file_size: string;
    status: string;
    created_at: string;
};