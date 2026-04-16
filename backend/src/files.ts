import { randomUUIDv7 } from "bun";
import { MAX_CHUNK_SIZE } from "./constants";
import { createMultipartUpload, abortFileUpload, completeUpload } from "./minio";
import { createUploadRecord, getUploadByUploadId, markUploadAborted, markUploadCompleted, setUploadErrorReason } from "./upload";

const getChunksForFile = (fileSize: number) => {
    return Math.ceil(fileSize / MAX_CHUNK_SIZE);
}

//add postgresql validations and additions as well
export const startUploadSession = async (fileName: string, fileSize: number, contentType: string) => {
    const chunks = getChunksForFile(fileSize);

    const objectKey = getObjectKey(fileName);

    //create record on sql side as well with init status
    const session = await createMultipartUpload(objectKey, chunks, contentType);

    try {
        const row = await createUploadRecord(
            session.uploadId,
            objectKey,
            fileName,
            contentType,
            fileSize,
            chunks
        );

        console.log("ROW START:", row);
        return session;
    } catch (error) {
        await abortFileUpload(objectKey, session.uploadId);
        throw error;
    }
}


export const uploadCompletion = async (uploadId: string, parts: { part: number; etag?: string | undefined; }[]) => {

    //fetch data from SQL to verify record then send for verification on minio side
    const uploadedRecord = await getUploadByUploadId(uploadId);

    if (!uploadedRecord) {
        throw new Error("No uploads found for ID: " + uploadId);
    }

    const result = await completeUpload(uploadedRecord.object_key, uploadId, parts);

    if (!result.completionResult || !result.objectInfo)
        return {
            status: "error",
            reason: "File upload was corrupted or didn't complete. Please try again."
        };

    const row = await markUploadCompleted(uploadId, result.objectInfo.etag);

    console.log("ROW COMPLETE: ", row);
    if (!row)
        return {
            status: "error",
            reason: "Couldn't mark upload completed. Please try again."
        }

    return {
        status: "complete",
        uploadId: uploadId,
        etag: result.objectInfo.etag
    }
}

export const uploadAbortion = async (uploadId: string) => {

    const uploadedRecord = await getUploadByUploadId(uploadId);

    if (!uploadedRecord) {
        throw new Error("No uploads found for ID: " + uploadId);
    }

    if (uploadedRecord.status === "completed") {
        throw new Error("Completed upload cannot be aborted");
    }

    if (uploadedRecord.status === "aborted") {
        return { status: "aborted", uploadId };
    }

    const result = await abortFileUpload(uploadedRecord.object_key, uploadId);

    if (!result) {
        await setUploadErrorReason(uploadId, "Failed to abort upload in storage. Please retry.");
        return {
            status: "error",
            reason: "Failed to abort upload in storage. Please retry."
        };
    }

    const row = await markUploadAborted(uploadId, uploadedRecord.object_key);

    console.log("ROW ABORT: ", row);
    if (!row)
        return {
            status: "error",
            reason: "Couldn't mark upload aborted. Please try again."
        }

    return {
        status: "aborted",
        uploadId: uploadId,
    }
}

const getObjectKey = (fileName: string) => {
    return randomUUIDv7() + "_" + fileName;
}