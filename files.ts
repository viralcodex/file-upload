import { uploadFileChunks } from "./file-upload";

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

type DeleteFilesResponse = {
    status: "ok" | "partial";
    markedIds: string[];
    skippedIds: string[];
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
                fileName: file.name,
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
                    body: JSON.stringify({ fileName: file.name, uploadId: entry.uploadId }),
                });
            } catch {}
        }
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
        const response = await fetch(`${BASE_URL}/files/delete`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ filesIds: fileIds })
        });

        const data = await response.json();

        if (!response.ok || data.error || data.reason) {
            throw new Error(data.reason || data.error || `Delete failed with status ${response.status}`);
        }

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

        const serverFiles: { file_id: string; original_file_name: string; content_type: string; file_size: string; status: string; created_at: string }[] = await res.json();

        // keep in-progress local uploads, replace the rest with server data
        const uploading = files.filter((f) => f.status === "uploading");
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

        files.push(...uploading);
        renderFileList();
    } catch (e) {
        console.error("Failed to fetch files", e);
    }
};

// Fetch on load
fetchFiles();
