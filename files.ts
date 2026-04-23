import { uploadFileChunks } from "./file-upload";
import { DeleteFilesResponse, ErrorResponse, FileEntry, ResumeUploadResponse, ServerFileEntry, UploadedPart } from "./models";

const BASE_URL = "http://localhost:8080";

const files: FileEntry[] = [];
const uploadFiles = new Map<string, File>();
const uploadControllers = new Map<string, AbortController>();
const pauseRequests = new Set<string>();
let idCounter = 0;

const fileListEl = document.getElementById("fileList") as HTMLUListElement | null;

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const getUserId = () => localStorage.getItem("user_id");

const requireUserId = () => {
    const userId = getUserId();

    if (!userId) {
        throw new Error("Register a user first");
    }

    return userId;
};

const isPausedError = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

const getActionLabel = (entry: FileEntry) => {
    if (entry.status === "paused") return "Resume";
    if (entry.status === "uploading" && entry.uploadId) return "Pause";
    return null;
};

const sortParts = (parts: UploadedPart[]) => [...parts].sort((left, right) => left.part - right.part);

const clearUploadState = (entryId: string, removeFile: boolean = false) => {
    uploadControllers.delete(entryId);
    pauseRequests.delete(entryId);

    const entry = files.find((item) => item.id === entryId);
    if (removeFile || entry?.status === "complete" || entry?.status === "error") {
        uploadFiles.delete(entryId);
    }
};

const pauseUpload = (entryId: string) => {
    pauseRequests.add(entryId);
    uploadControllers.get(entryId)?.abort();
    updateEntry(entryId, { status: "paused", statusText: "Paused" });
};

const completeUpload = async (entryId: string, uploadId: string, parts: UploadedPart[]) => {
    updateEntry(entryId, { statusText: "Completing…" });

    const responseComplete = await fetch(`${BASE_URL}/upload/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            userId: requireUserId(),
            parts: sortParts(parts),
            uploadId,
        }),
    });

    if (!responseComplete.ok) {
        const error = await responseComplete.json() as ErrorResponse;
        throw new Error(error.reason || error.error || "Complete request failed");
    }

    const responseData = await responseComplete.json() as { status: string; reason?: string };

    if (responseData.status !== "complete") {
        throw new Error(responseData.reason || "Upload failed");
    }

    clearUploadState(entryId);
    updateEntry(entryId, { status: "complete", statusText: "Uploaded" });
};

const resumeFileUpload = async (entryId: string) => {
    const entry = files.find((item) => item.id === entryId);
    const file = uploadFiles.get(entryId);

    if (!entry || !file || !entry.uploadId) {
        updateEntry(entryId, { status: "error", statusText: "Cannot resume this upload" });
        return;
    }

    const controller = new AbortController();
    uploadControllers.set(entryId, controller);
    pauseRequests.delete(entryId);
    updateEntry(entryId, { status: "uploading", statusText: "Resuming…" });

    try {
        const resumeResponse = await fetch(`${BASE_URL}/upload/resume`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId: requireUserId(),
                uploadId: entry.uploadId,
                fileName: file.name,
                fileSize: file.size,
                contentType: file.type,
            }),
        });

        if (!resumeResponse.ok) {
            const error = await resumeResponse.json() as ErrorResponse;
            throw new Error(error.reason || error.error || "Resume request failed");
        }

        const resumeData = await resumeResponse.json() as ResumeUploadResponse;
        const remainingUrls = resumeData.remainingParts.map((part) => part.url);
        const remainingPartNumbers = resumeData.remainingParts.map((part) => part.part);
        const uploadedParts = resumeData.uploadedParts;

        const remainingUploadedParts = remainingUrls.length > 0
            ? await uploadFileChunks(file, remainingUrls, remainingPartNumbers, uploadedParts.length + remainingUrls.length, controller.signal)
            : [];

        await completeUpload(entryId, entry.uploadId, [...uploadedParts, ...remainingUploadedParts]);
    } catch (error) {
        if (isPausedError(error) || pauseRequests.has(entryId)) {
            uploadControllers.delete(entryId);
            updateEntry(entryId, { status: "paused", statusText: "Paused" });
            return;
        }

        clearUploadState(entryId);
        updateEntry(entryId, {
            status: "error",
            statusText: error instanceof Error ? error.message : "Resume failed",
        });
    }
};

export const registerUser = async (): Promise<string | null> => {
    const existing = localStorage.getItem("user_id");
    if (existing) return existing;

    try {
        const res = await fetch(`${BASE_URL}/users`, { method: "POST" });
        if (!res.ok) return null;
        const { userId } = await res.json();
        localStorage.setItem("user_id", userId);
        return userId;
    } catch {
        return null;
    }
}

const renderFileList = () => {
    if (!fileListEl) return;

    if (files.length === 0) {
        fileListEl.innerHTML = `<li class="file-item file-item--empty">No files yet. Click + to add one.</li>`;
        return;
    }

    fileListEl.innerHTML = files
        .map(
            (f) => `
            <li class="file-item ${f.status === 'uploading' ? 'file-item--uploading' : ''} ${f.status === 'paused' ? 'file-item--paused' : ''} ${f.status === 'error' ? 'file-item--error' : ''} ${f.selected ? 'file-item--selected' : ''}" data-id="${f.id}">
                <div class="file-item-row">
                    <input type="checkbox" class="file-checkbox" data-id="${f.id}" ${f.selected ? 'checked' : ''}>
                    <div class="file-item-info">
                        <div class="file-item-name">${f.fileName}</div>
                        <div class="file-item-meta">
                            <span>${formatSize(f.fileSize)}</span>
                            <span class="file-item-status file-item-status--${f.status}">${f.statusText}</span>
                        </div>
                    </div>
                    ${getActionLabel(f) ? `<button type="button" class="file-action-btn" data-action="toggle-upload" data-id="${f.id}">${getActionLabel(f)}</button>` : ""}
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

    fileListEl.querySelectorAll<HTMLButtonElement>(".file-action-btn").forEach((button) => {
        button.addEventListener("click", async () => {
            const entry = files.find((item) => item.id === button.dataset.id);
            if (!entry) return;

            if (entry.status === "paused") {
                await resumeFileUpload(entry.id);
                return;
            }

            if (entry.status === "uploading") {
                pauseUpload(entry.id);
            }
        });
    });
};

const updateEntry = (id: string, updates: Partial<FileEntry>) => {
    const entry = files.find((f) => f.id === id);
    if (entry) Object.assign(entry, updates);
    renderFileList();
};

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
        const responseInit = await fetch(`${BASE_URL}/upload/init`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId: requireUserId(),
                fileName: file.name,
                fileSize: file.size,
                contentType: file.type,
            }),
        });

        if (!responseInit.ok) {
            const errorText = await responseInit.text();
            updateEntry(id, { status: "error", statusText: errorText || `Init failed (${responseInit.status})` });
            clearUploadState(id, true);
            return;
        }

        const data = await responseInit.json();
        entry.uploadId = data.uploadId;

        const preSignedUrls: string[] = data.urls;
        if (!preSignedUrls || preSignedUrls.length === 0) {
            updateEntry(id, { status: "error", statusText: "No pre-signed URLs received" });
            clearUploadState(id, true);
            return;
        }

        const controller = new AbortController();
        uploadControllers.set(id, controller);
        pauseRequests.delete(id);

        updateEntry(id, { statusText: "Uploading chunks…" });

        const parts = await uploadFileChunks(file, preSignedUrls, undefined, preSignedUrls.length, controller.signal);
        await completeUpload(id, data.uploadId, parts);
    } catch (e: unknown) {
        if (isPausedError(e) || pauseRequests.has(id)) {
            uploadControllers.delete(id);
            updateEntry(id, { status: "paused", statusText: "Paused" });
            return;
        }

        updateEntry(id, { status: "error", statusText: e instanceof Error ? e.message : "Upload failed" });
        if (entry.uploadId) {
            try {
                await fetch(`${BASE_URL}/upload/abort`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: requireUserId(), uploadId: entry.uploadId }),
                });
            } catch {}
        }
        clearUploadState(id, true);
    }
};

export const deleteSelected = async () => {
    const selected = files.filter((f) => f.selected);
    if (selected.length === 0) return;

    const filesIds = selected.flatMap((f) => f.uploadId ? [f.uploadId] : []);

    if (filesIds.length > 0) {
        try {
            const res = await fetch(`${BASE_URL}/files/delete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: requireUserId(), filesIds }),
            });

            if (!res.ok) {
                return;
            }

            await res.json() as DeleteFilesResponse;
        } catch {
            return;
        }
    }

    const remaining = files.filter((f) => !f.selected);
    for (const entry of files.filter((f) => f.selected)) {
        clearUploadState(entry.id, true);
    }
    files.length = 0;
    files.push(...remaining);
    renderFileList();
};

export const fetchFiles = async () => {
    try {
        const res = await fetch(`${BASE_URL}/files?userId=${encodeURIComponent(requireUserId())}`);
        if (!res.ok) return;

        const serverFiles: ServerFileEntry[] = await res.json();

        // keep local in-progress uploads, replace completed server-backed entries
        const pendingLocalEntries = files.filter((f) => f.status === "uploading" || f.status === "paused");
        files.length = 0;

        for (const sf of serverFiles) {
            files.push({
                id: String(++idCounter),
                fileName: sf.original_file_name,
                fileSize: Number(sf.file_size),
                contentType: sf.content_type,
                status: "complete",
                statusText: "Uploaded",
                uploadId: sf.file_id,
                selected: false,
            });
        }

        files.push(...pendingLocalEntries);
        renderFileList();
    } catch (e) {
        console.error("Failed to fetch files", e);
    }
};

renderFileList();