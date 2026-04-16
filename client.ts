import { uploadFileChunks } from "./file-upload";

const inputElement = document.getElementById("fileInput") as HTMLInputElement | null;
const uploadElement = document.getElementById("uploadButton") as HTMLInputElement | null;
const backendStatus = document.getElementById("backendStatus") as HTMLParagraphElement | null;

if (!inputElement || !uploadElement || !backendStatus) {
    throw new Error("Needed Elements not found in DOM");
}

let file: File | null;

const BASE_URL = "http://localhost:8080"

const getFile = (event: Event) => {
    const files = (event.currentTarget as HTMLInputElement).files;

    if (!files || files.length === 0) {
        return;
    }

    file = files[0];
    console.log(file);
}

//call /upload and upload directly to the pre-sgined url to minio
const handleFileUpload = async (event: Event) => {
    try {
        if (!file) {
            backendStatus.textContent = "Error: No file selected";
            return;
        }
        backendStatus.textContent = "Initializing upload...";
        const responseInit = await fetch(`${BASE_URL}/upload/init`, {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileName: file.name,
                fileSize: file.size,
                contentType: file.type
            })
        });

        if (!responseInit.ok) {
            const errorText = await responseInit.text();
            backendStatus.textContent = `Error: ${errorText || `Upload init failed with status ${responseInit.status}`}`;
            return;
        }

        //after this we get the response to start the upload
        const data = await responseInit.json();
        const preSignedUrls: string[] = data.urls;

        if (!preSignedUrls || preSignedUrls.length === 0) {
            backendStatus.textContent = "Error: No pre-signed URLs received from the server";
            return;
        }

        console.log("Received pre-signed URLs:", preSignedUrls);
        backendStatus.textContent = "Uploading chunks...";

        //upload the file in chunks to the pre-signed URLs
        try {
            const parts = await uploadFileChunks(file, preSignedUrls);

            const responseComplete = await fetch(`${BASE_URL}/upload/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fileName: file.name,
                    parts,
                    uploadId: data.uploadId
                })
            })

            if (!responseComplete.ok) {
                backendStatus.textContent = `Error: Failed to upload the file ${file.name}`;
                return;
            }
            const responseData = await responseComplete.json();

            backendStatus.textContent = `Status: ${responseData.status}${responseData.reason ? ' — ' + responseData.reason : ''}`;
            console.log("File uploaded! ", file.name);
        } catch (e: any) {
            backendStatus.textContent = `Error: ${e.message || "Upload failed"}`;
            if (data?.uploadId) {
                try {
                    await fetch(`${BASE_URL}/upload/abort`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            fileName: file.name,
                            uploadId: data.uploadId
                        })
                    })
                    backendStatus.textContent += " (upload aborted)";
                } catch (abortErr) {
                    backendStatus.textContent += " (abort also failed)";
                }
            }
        }
    } catch (e: any) {
        backendStatus.textContent = `Error: ${e.message || "Unexpected error"}`;
    }
}

inputElement.addEventListener("change", getFile);
uploadElement.addEventListener("click", handleFileUpload);
