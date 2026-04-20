import { abortFileUpload, cleanupStaleIncompleteUploads, deleteFileObjects } from "./minio";
import { getMarkedForDelete, getStaleUploads, markUploadAborted, setErrorReason, setUploadsDeleted } from "./upload";

const STALE_UPLOADS_AGE_MS = 2 * 3600 * 1000; // 2 hrs old
const STALE_INCOMPLETE_UPLOADS_AGE_MS = 30 * 60 * 1000; //30 minutes old

const cleanup = async () => {
    const staleUploads = await getStaleUploads(STALE_UPLOADS_AGE_MS);
    const markedForDelete = await getMarkedForDelete();

    //stale uploads that didn't complete
    await Promise.all(
        staleUploads.map(async (upload) => {
            try {
                const aborted = await abortFileUpload(upload.object_key, upload.upload_id);
                if (!aborted) {
                    await setErrorReason(upload.upload_id, "Background cleanup could not abort multipart upload");
                    return;
                }
                await markUploadAborted(upload.upload_id, upload.object_key);
                console.log(`Cleaned upload ${upload.upload_id}`);
            } catch (e) {
                const reason = e instanceof Error ? e.message : "Background cleanup failed";
                await setErrorReason(upload.upload_id, reason);
                console.error(`Cleanup failed for ${upload.upload_id}`, e);
            }
        })
    );

    await cleanupStaleIncompleteUploads(STALE_INCOMPLETE_UPLOADS_AGE_MS);

    //db cleanup with minio for marked as deleted files
    try {
        const errors = await deleteFileObjects(markedForDelete.map(upload => upload.object_key));

        const failedKeys = new Set(
            errors
                .map((error) => error?.Key)
                .filter((key): key is string => Boolean(key))
        );
        const succeededUploads = markedForDelete.filter((upload) => !failedKeys.has(upload.object_key));
        const failedUploads = markedForDelete.filter((upload) => failedKeys.has(upload.object_key));

        await Promise.all(
            failedUploads.map((upload) =>
                setErrorReason(upload.upload_id, "Deletion failed in object storage")
            )
        );

        if (succeededUploads.length > 0) {
            const rows = await setUploadsDeleted(succeededUploads.map((upload) => upload.upload_id));
            console.log("Files deleted:");
            console.table(rows);
        }

        return;
    } catch (e) {
        await Promise.all(
            markedForDelete.map((upload) =>
                setErrorReason(upload.upload_id, "Delete process failed")
            )
        );
        throw new Error("Delete process failed: " + e);
    }
}

cleanup()
    .then(() => process.exit(0))
    .catch(e => {
        console.error("Cleanup job failed: ", e);
        process.exit(1);
    })