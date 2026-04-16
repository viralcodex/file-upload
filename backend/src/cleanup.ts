import { abortFileUpload } from "./minio";
import { getStaleUploads, markUploadAborted, setUploadErrorReason } from "./upload";

const STALE_UPLOADS_AGE_MS = 2 * 3600 * 100; // 2 hrs old

const cleanup = async () => {
    const staleUploads = await getStaleUploads(STALE_UPLOADS_AGE_MS);

    for (const upload of staleUploads) {
        try {
            const aborted = await abortFileUpload(upload.object_key, upload.upload_id);

            if (!aborted) {
                await setUploadErrorReason(upload.upload_id, "Background cleanup could not abort multipart upload");
            }

            await markUploadAborted(upload.upload_id, upload.object_key);
            console.log(`Cleaned upload ${upload.upload_id}`);
        } catch (e) {
            const reason = e instanceof Error ? e.message : "Background cleanup failed";
            await setUploadErrorReason(upload.upload_id, reason);
            console.error(`Cleanup failed for ${upload.upload_id}`, e);
        }
    }
}

cleanup()
    .then(() => process.exit(0))
    .catch(e => { 
        console.error("Cleanup job failed: ", e); 
        process.exit(1); 
    })