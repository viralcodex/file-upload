import { uploadFileChunks } from "./file-upload";
import { ServerFileEntry } from "./models";

const BASE_URL = "http://localhost:8080";

export interface FileEntry {
    id: string;
    fileName: string;
    fileSize: number;
    contentType: string;
    status: "uploading" | "complete" | "error";
    statusText: string;
    uploadId?: string;
    selected: boolean;
}

const files: FileEntry[] = [];
let idCounter = 0;

const fileListEl = document.getElementById("fileList") as HTMLUListElement | null;

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const getUserId = () => localStorage.getItem("user_id");

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
            <li class="file-item ${f.status === 'uploading' ? 'file-item--uploading' : ''} ${f.status === 'error' ? 'file-item--error' : ''} ${f.selected ? 'file-item--selected' : ''}" data-id="${f.id}">
                <div class="file-item-row">
                    <input type="checkbox" class="file-checkbox" data-id="${f.id}" ${f.selected ? 'checked' : ''}>
                    <div class="file-item-info">
                        <div class="file-item-name">${f.fileName}</div>
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
    renderFileList();

    try {
        const responseInit = await fetch(`${BASE_URL}/upload/init`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId: getUserId(),
                fileName: file.name,
                fileSize: file.size,
                contentType: file.type,
            }),
        });

        if (!responseInit.ok) {
            const errorText = await responseInit.text();
            updateEntry(id, { status: "error", statusText: errorText || `Init failed (${responseInit.status})` });
            return;
        }

        const data = await responseInit.json();
        entry.uploadId = data.uploadId;

        const preSignedUrls: string[] = data.urls;
        if (!preSignedUrls || preSignedUrls.length === 0) {
            updateEntry(id, { status: "error", statusText: "No pre-signed URLs received" });
            return;
        }

        updateEntry(id, { statusText: "Uploading chunks…" });

        const parts = await uploadFileChunks(file, preSignedUrls);

        updateEntry(id, { statusText: "Completing…" });

        const responseComplete = await fetch(`${BASE_URL}/upload/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId: getUserId(),
                parts,
                uploadId: data.uploadId,
            }),
        });

        if (!responseComplete.ok) {
            updateEntry(id, { status: "error", statusText: "Complete request failed" });
            return;
        }

        const responseData = await responseComplete.json();

        if (responseData.status === "complete") {
            updateEntry(id, { status: "complete", statusText: "Uploaded" });
        } else {
            updateEntry(id, { status: "error", statusText: responseData.reason || "Upload failed" });
        }
    } catch (e: any) {
        updateEntry(id, { status: "error", statusText: e.message || "Upload failed" });
        if (entry.uploadId) {
            try {
                await fetch(`${BASE_URL}/upload/abort`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: getUserId(), uploadId: entry.uploadId }),
                });
            } catch {}
        }
    }
};

export const deleteSelected = async () => {
    const selected = files.filter((f) => f.selected);
    if (selected.length === 0) return;

    const filesIds = selected.map((f) => f.uploadId).filter(Boolean);

    try {
        const res = await fetch(`${BASE_URL}/files/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: getUserId(), filesIds }),
        });
        if (!res.ok) return;
    } catch { }

    const remaining = files.filter((f) => !f.selected);
    files.length = 0;
    files.push(...remaining);
    renderFileList();
};

// Initial render
renderFileList();

export const fetchFiles = async () => {
    try {
        const res = await fetch(`${BASE_URL}/files?userId=${getUserId()}`);
        if (!res.ok) return;

        const serverFiles: ServerFileEntry[] = await res.json();

        // keep in-progress local uploads, replace the rest with server data
        const uploading = files.filter((f) => f.status === "uploading");
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

        files.push(...uploading);
        renderFileList();
    } catch (e) {
        console.error("Failed to fetch files", e);
    }
};