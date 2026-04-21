import { uploadFileChunks } from "./file-upload";
import { DeleteFilesResponse, ErrorResponse, FileEntry, ResumeUploadResponse, ServerFileEntry, UploadedPart } from './models.ts';

const BASE_URL = "http://localhost:8080";
const RETRYABLE_UPLOAD_STATUS = "Upload paused. Retrying when connection returns.";
const TERMINAL_RESUME_REASONS = new Set([
    "Cannot resume this upload.",
    "Upload metadata does not match.",
]);
const files: FileEntry[] = [];
let idCounter = 0;
const uploadFiles = new Map<string, File>();

const fileListEl = document.getElementById("fileList") as HTMLUListElement | null;

const escapeHtml = (str: string): string =>
    str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const renderFileList = () => {
    if (!fileListEl) return;

    if (files.length === 0) {
        fileListEl.innerHTML = `<li class="file-item file-item--empty">No files yet. Click + to add one.</li>`;
        return;
    }

    fileListEl.innerHTML = files
        .map(
            (f) => `
            <li class="file-item ${f.status === 'uploading' ? 'file-item--uploading' : ''} ${f.status === 'error' ? 'file-item--error' : ''} ${f.selected ? 'file-item--selected' : ''}" data-id="${f.id}">
                <div class="file-item-row">
                    <input type="checkbox" class="file-checkbox" data-id="${f.id}" ${f.selected ? 'checked' : ''}>
                    <div class="file-item-info">
                        <div class="file-item-name">${escapeHtml(f.fileName)}</div>
                        <div class="file-item-meta">
                            <span>${formatSize(f.fileSize)}</span>
                            <span class="file-item-status file-item-status--${f.status}">${f.statusText}</span>
                        </div>
                    </div>
                </div>
            </li>`
        )
        .join("");

    // bind checkbox events
    fileListEl.querySelectorAll<HTMLInputElement>(".file-checkbox").forEach((cb) => {
        cb.addEventListener("change", () => {
            const entry = files.find((f) => f.id === cb.dataset.id);
            if (entry) {
                entry.selected = cb.checked;
                renderFileList();
            }
        });
    });
};

const updateEntry = (id: string, updates: Partial<FileEntry>) => {
    const entry = files.find((f) => f.id === id);
    if (entry) Object.assign(entry, updates);
    renderFileList();
};

const postJson = async <T>(path: string, body: unknown) => {
    const response = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    const data: T & ErrorResponse = await response.json();

    if (!response.ok || data.error || (data.status === "error" && data.reason)) {
        throw new Error(data.reason || data.error || `Request failed with status ${response.status}`);
    }

    return data;
};

const hasCompletedUpload = async (uploadId: string) => {
    const response = await fetch(`${BASE_URL}/files`);

    if (!response.ok) {
        throw new Error(`Failed to verify upload status (${response.status})`);
    }

    const serverFiles: { file_id: string }[] = await response.json();
    return serverFiles.some((file) => file.file_id === uploadId);
};

const completeUpload = async (uploadId: string, fileName: string, parts: UploadedPart[]) => {
    try {
        const data = await postJson<{ status: string }>("/upload/complete", {
            fileName,
            parts,
            uploadId,
        });

        if (data.status !== "complete") {
            throw new Error("Upload failed");
        }
    } catch (error) {
        if (await hasCompletedUpload(uploadId)) {
            return;
        }

        throw error;
    }
};

const isTerminalResumeError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "Upload failed";

    return (
        message.startsWith("No uploads found for ID:") ||
        TERMINAL_RESUME_REASONS.has(message)
    );
};

const tryResumeUpload = async (entryId: string) => {
    const entry = files.find((file) => file.id === entryId);
    const file = uploadFiles.get(entryId);

    if (!entry?.uploadId || !file) {
        return;
    }

    try {
        if (await hasCompletedUpload(entry.uploadId)) {
            updateEntry(entryId, { status: "complete", statusText: "Uploaded" });
            uploadFiles.delete(entryId);
            return;
        }

        updateEntry(entryId, { status: "uploading", statusText: "Resuming upload…" });

        const { uploadedParts, remainingParts } = await postJson<ResumeUploadResponse>("/upload/resume", {
            uploadId: entry.uploadId,
            fileName: file.name,
            fileSize: file.size,
            contentType: file.type,
        });
        const totalChunks = uploadedParts.length + remainingParts.length;
        const resumedParts = remainingParts.length === 0
            ? []
            : await uploadFileChunks(
                file,
                remainingParts.map((part) => part.url),
                remainingParts.map((part) => part.part),
                totalChunks,
            );
        const allParts = [...uploadedParts, ...resumedParts].sort((a, b) => a.part - b.part);

        updateEntry(entryId, { statusText: "Completing…" });
        await completeUpload(entry.uploadId, file.name, allParts);
        updateEntry(entryId, { status: "complete", statusText: "Uploaded" });
        uploadFiles.delete(entryId);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";

        if (isTerminalResumeError(error)) {
            updateEntry(entryId, { status: "error", statusText: message });
            uploadFiles.delete(entryId);
            return;
        }

        updateEntry(entryId, { status: "error", statusText: RETRYABLE_UPLOAD_STATUS });
    }
};

window.addEventListener("online", () => {
    files
        .filter((file) => file.uploadId && file.status === "error" && file.statusText === RETRYABLE_UPLOAD_STATUS)
        .forEach((file) => {
            void tryResumeUpload(file.id);
        });
});


export const addFileAndUpload = async (file: File) => {
    const id = String(++idCounter);
    const entry: FileEntry = {
        id,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
        status: "uploading",
        statusText: "Initializing…",
        selected: false,
    };
    files.push(entry);
    uploadFiles.set(id, file);
    renderFileList();

    try {
        const data = await postJson<{ uploadId: string; urls: string[] }>("/upload/init", {
            fileName: file.name,
            fileSize: file.size,
            contentType: file.type,
        });
        entry.uploadId = data.uploadId;

        const preSignedUrls: string[] = data.urls;
        if (!preSignedUrls || preSignedUrls.length === 0) {
            updateEntry(id, { status: "error", statusText: "No pre-signed URLs received" });
            return;
        }

        updateEntry(id, { statusText: "Uploading chunks…" });

        const parts = await uploadFileChunks(file, preSignedUrls);

        updateEntry(id, { statusText: "Completing…" });

        await completeUpload(data.uploadId, file.name, parts);

        updateEntry(id, { status: "complete", statusText: "Uploaded" });
        uploadFiles.delete(id);

    } catch (e: any) {
        if (entry.uploadId) {
            await tryResumeUpload(id);
            return;
        }

        updateEntry(id, { status: "error", statusText: e.message || "Upload failed" });
        uploadFiles.delete(id);
    }
};

export const deleteSelected = async () => {
    const markForDeletion = files
        .filter((f) => f.selected && f.uploadId)
        .map((file) => file.uploadId!);

    if (markForDeletion.length === 0) {
        return;
    }

    const result = await markFilesForDeletion(markForDeletion);
    const remaining = files.filter((f) => !f.uploadId || !result.markedIds.includes(f.uploadId));
    files.length = 0;
    files.push(...remaining);
    renderFileList();
};

// Initial render
renderFileList();

export const markFilesForDeletion = async (fileIds: string[]): Promise<DeleteFilesResponse> => {
    try {
        const data = await postJson<DeleteFilesResponse>("/files/delete", { filesIds: fileIds });

        return {
            status: data.status,
            markedIds: data.markedIds ?? [],
            skippedIds: data.skippedIds ?? [],
        };
    } catch (e) {
        throw new Error(e instanceof Error ? e.message : "Failed to mark files for deletion");
    }
}

export const fetchFiles = async () => {
    try {
        const res = await fetch(`${BASE_URL}/files`);
        if (!res.ok) return;

        const serverFiles: ServerFileEntry[] = await res.json();
        const serverIds = new Set(serverFiles.map((file) => file.file_id));

        // keep local uploads that are still pending and not already finalized on the server
        const pendingLocalFiles = files.filter((f) => f.status !== "complete" && (!f.uploadId || !serverIds.has(f.uploadId)));
        files.length = 0;

        for (const sf of serverFiles) {
            files.push({
                id: sf.file_id,
                fileName: sf.original_file_name,
                fileSize: Number(sf.file_size),
                contentType: sf.content_type,
                status: "complete",
                statusText: "Uploaded",
                uploadId: sf.file_id,
                selected: false,
            });
        }

        files.push(...pendingLocalFiles);
        renderFileList();
    } catch (e) {
        console.error("Failed to fetch files", e);
    }
};

// Fetch on load
fetchFiles();
