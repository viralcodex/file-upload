import { randomUUIDv7 } from "bun";
import { MAX_CHUNK_SIZE } from "./constants";
import { createMultipartUpload, abortFileUpload, completeUpload, getUploadedParts, getPreSignedUrlsForParts } from "./minio";
import { createUploadRecord, getFiles, getUploadByUploadId, markUploadForDeletion, markUploadAborted, markUploadCompleted, setErrorReason, setUploadsDeleted } from "./upload";
import type { UploadRecord } from "./models/models";

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
        const aborted = await abortFileUpload(objectKey, session.uploadId);

        if (!aborted) {
            console.error("Rollback abort failed", {
                uploadId: session.uploadId,
                objectKey,
            });
            
        }

        throw error;
    }
}

export const resumeUpload = async (uploadId: string, fileName: string, fileSize: number, contentType: string) => {
    const uploadedRecord = ensureUploadExists(await getUploadByUploadId(uploadId), uploadId);

    if (uploadedRecord.status !== "initiated") {
        throw new Error("Cannot resume this upload.");
    }

    if (
        uploadedRecord.original_file_name !== fileName ||
        Number(uploadedRecord.file_size) !== fileSize ||
        uploadedRecord.content_type !== contentType
    ) {
        throw new Error("Upload metadata does not match.");
    }

    const uploadedParts = await getUploadedParts(uploadedRecord.object_key, uploadId);

    const uploadedPartNumbers = uploadedParts.map((part) => part.part);
    
    const missingPartNumbers = Array.from(
        { length: Number(uploadedRecord.chunk_count) },
        (_, index) => index + 1
    ).filter((partNumber) => !uploadedPartNumbers.includes(partNumber));

    const remainingParts = await getPreSignedUrlsForParts(
        uploadedRecord.object_key,
        uploadedRecord.upload_id,
        missingPartNumbers
    );

    return {
        uploadId: uploadedRecord.upload_id,
        uploadedParts,
        remainingParts,
    };
}


export const uploadCompletion = async (uploadId: string, parts: { part: number; etag?: string | undefined; }[]) => {

    //fetch data from SQL to verify record then send for verification on minio side
    const uploadedRecord = ensureUploadExists(await getUploadByUploadId(uploadId), uploadId);

    if (uploadedRecord.status !== "initiated") {
        throw new Error("Cannot complete this upload.");
    }

    const result = await completeUpload(uploadedRecord.object_key, uploadId, parts);

    if (!result.completionResult || !result.objectInfo) {
        throw new Error("File upload was corrupted or didn't complete. Please try again.");
    }

    const row = await markUploadCompleted(uploadId, result.objectInfo.etag);
    
    console.log("ROW COMPLETE: ", row);
    if (!row) {
        throw new Error("Couldn't mark upload completed. Please try again.");
    }

    return {
        status: "complete",
        uploadId: uploadId,
        etag: result.objectInfo.etag
    }
}

export const uploadAbortion = async (uploadId: string) => {

    const uploadedRecord = ensureUploadExists(await getUploadByUploadId(uploadId), uploadId);
    
    if (uploadedRecord.status === "aborted") {
        return { status: "aborted", uploadId };
    }

    if (uploadedRecord.status !== "initiated") {
        throw new Error("Cannot abort this upload.");
    }
    
    const result = await abortFileUpload(uploadedRecord.object_key, uploadId);

    if (!result) {
        await setErrorReason(uploadId, "Failed to abort upload in storage. Please retry.");
        throw new Error("Failed to abort upload in storage. Please retry.");

    }

    const row = await markUploadAborted(uploadId, uploadedRecord.object_key);

    console.log("ROW ABORT: ", row);
    if (!row)
        throw new Error("Couldn't mark upload aborted. Please try again.");

    return {
        status: "aborted",
        uploadId: uploadId,
    }
}

export const getUploadedFiles = async () => {
    const files = await getFiles();
    return files;
}

export const markSelectedFilesForDeletion = async (fileIds: string[]) => {
    
    const updatedRows = await markUploadForDeletion(fileIds);

    const markedIds = updatedRows.map(row => row.upload_id);

    const skippedIds = fileIds.filter(id => !markedIds.includes(id));

    return {
        status: skippedIds.length > 0 ? "partial" : "ok",
        markedIds,
        skippedIds,
    }
}

const getObjectKey = (fileName: string) => {
    return randomUUIDv7() + "_" + fileName;
}

const ensureUploadExists = (uploadedRecord: UploadRecord | null, uploadId: string) => {

    if (!uploadedRecord) {
        throw new Error("No uploads found for ID: " + uploadId);
    }

    return uploadedRecord;
}