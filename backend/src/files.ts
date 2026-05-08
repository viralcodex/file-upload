import { randomUUIDv7 } from "bun";
import { MAX_CHUNK_SIZE } from "./constants";
import { createMultipartUpload, abortFileUpload, completeUpload, getUploadedParts, getPreSignedUrlsForParts, getPreSignedUrlForDownload } from "./minio";
import { createUploadRecord, getFilesByUserId, getUploadByUploadAndUserId, markUploadForDeletion, markUploadAborted, markUploadCompleted, setErrorReason } from "./upload";
import type { UploadRecord } from "./models/models";

const getChunksForFile = (fileSize: number) => {
    return Math.ceil(fileSize / MAX_CHUNK_SIZE);
}

//add postgresql validations and additions as well
export const startUploadSession = async (userId: string, fileName: string, fileSize: number, contentType: string) => {
    const chunks = getChunksForFile(fileSize);

    const objectKey = getObjectKey(fileName);

    //create record on sql side as well with init status
    const session = await createMultipartUpload(objectKey, chunks, contentType);

    try {
        const row = await createUploadRecord(
            userId,
            session.uploadId,
            objectKey,
            fileName,
            contentType,
            fileSize,
            chunks,
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

export const resumeUpload = async (userId: string, uploadId: string, fileName: string, fileSize: number, contentType: string) => {
    const uploadedRecord = ensureUploadExists(await getUploadByUploadAndUserId(userId, uploadId), uploadId);

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


export const uploadCompletion = async (userId: string, uploadId: string, parts: { part: number; etag?: string | undefined; }[]) => {

    //fetch data from SQL to verify record then send for verification on minio side
    const uploadedRecord = ensureUploadExists(await getUploadByUploadAndUserId(userId, uploadId), uploadId);

    if (uploadedRecord.status !== "initiated") {
        throw new Error("Cannot complete this upload.");
    }

    const result = await completeUpload(uploadedRecord.object_key, uploadId, parts);

    if (!result.completionResult || !result.objectInfo) {
        throw new Error("File upload was corrupted or didn't complete. Please try again.");
    }

    const row = await markUploadCompleted(userId, uploadId, result.objectInfo.etag);
    
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

export const uploadAbortion = async (userId: string, uploadId: string) => {

    const uploadedRecord = ensureUploadExists(await getUploadByUploadAndUserId(userId, uploadId), uploadId);
    
    if (uploadedRecord.status === "aborted") {
        return { status: "aborted", uploadId };
    }

    if (uploadedRecord.status !== "initiated") {
        throw new Error("Cannot abort this upload.");
    }
    
    const result = await abortFileUpload(uploadedRecord.object_key, uploadId);

    if (!result) {
        await setErrorReason(userId, uploadId, "Failed to abort upload in storage. Please retry.");
        throw new Error("Failed to abort upload in storage. Please retry.");

    }

    const row = await markUploadAborted(userId, uploadId);

    console.log("ROW ABORT: ", row);
    if (!row)
        throw new Error("Couldn't mark upload aborted. Please try again.");

    return {
        status: "aborted",
        uploadId: uploadId,
    }
}

export const getUploadedFiles = async (userId: string) => {
    const files = await getFilesByUserId(userId);
    return files;
}

export const downloadFile = async (userId: string, fileId: string) => {
    const uploadedRecord = ensureUploadExists(await getUploadByUploadAndUserId(userId, fileId), fileId);

    if (uploadedRecord.status !== "completed") {
        throw new Error("File is not available for download.");
    }

    try {
        const url = await getPreSignedUrlForDownload(
            uploadedRecord.object_key,
            uploadedRecord.original_file_name,
        );
        return {
            url,
            fileName: uploadedRecord.original_file_name,
        };
    } catch (error) {
        console.error("Failed to get pre-signed URL for download", error);
        throw new Error("Failed to get download URL. Please try again.");
    }

}

export const markSelectedFilesForDeletion = async (userId: string, fileIds: string[]) => {
    
    const updatedRows = await markUploadForDeletion(userId, fileIds);

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