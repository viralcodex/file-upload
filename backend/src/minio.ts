import { Client } from "minio";

const minioClient = new Client({
    endPoint: "localhost",
    port: 9000,
    useSSL: false,
    accessKey: "minioadmin",
    secretKey: "minioadmin"
});

const getOrCreateBucket = async () => {
    const bucketExists = await minioClient.bucketExists("files");

    if (!bucketExists) {
        await minioClient.makeBucket("files");
    }

    return "files";
}

export const createMultipartUpload = async (objectKey: string, chunks: number, contentType: string) => {

    const bucketName = await getOrCreateBucket();
    const uploadId = await minioClient.initiateNewMultipartUpload(bucketName, objectKey, { 'content-type': contentType });

    const urls = await getPreSignedUrlsForChunks(objectKey, chunks, uploadId);

    return { uploadId, urls };
}

const getPreSignedUrlsForChunks = async (objectKey: string, chunks: number, uploadId: string) => {
    const bucketName = await getOrCreateBucket();

    const urls: string[] = [];

    for (let i = 0; i < chunks; i++) {
        const url = await minioClient.presignedUrl("PUT", bucketName, objectKey, 1800, { uploadId, partNumber: `${i + 1}` }); // URL valid for 30 minutes
        urls.push(url);
    }

    return urls;
}

export const completeUpload = async (objectKey: string, uploadId: string, parts: { part: number; etag?: string | undefined; }[]) => {

    const bucketName = await getOrCreateBucket();

    await verifyUpload(bucketName, objectKey, uploadId, parts);

    const completionResult = await minioClient.completeMultipartUpload(bucketName, objectKey, uploadId, parts);

    const objectInfo = await minioClient.statObject(bucketName, objectKey);

    return { completionResult, objectInfo };
}

export const abortFileUpload = async (objectKey: string, uploadId: string) => {

    const bucketName = await getOrCreateBucket();

    try {
        await minioClient.abortMultipartUpload(bucketName, objectKey, uploadId)
    } catch (e: any) {
        return false;
    }

    return true;
}

export const deleteFileObjects = async (objectKeys: string[]) => {
    const bucketName = await getOrCreateBucket();

    try {
        const errors = await minioClient.removeObjects(bucketName, objectKeys);
        const response = Object.values(errors).map((value) => value?.Error);

        return response;
    } catch (e) {
        throw new Error("Deletion from Object storage failed: " + e);
    }
}

export const cleanupStaleIncompleteUploads = async (ageMs: number) => {
    const bucketName = await getOrCreateBucket();
    const cutOff = Date.now() - ageMs;
    let keyMarker = "";
    let uploadIdMarker = "";
    let isTruncated = true;

    while (isTruncated) {
        const result = await minioClient.listIncompleteUploadsQuery(bucketName, "", keyMarker, uploadIdMarker, "");

        const staleUploads = result.uploads.filter((upload) => upload.initiated.getTime() < cutOff);

        for (const upload of staleUploads) {
            try {
                await minioClient.removeIncompleteUpload(bucketName, upload.key);
                console.log(`Removed orphan multipart upload for ${upload.key}`);
            } catch (e) {
                console.error(`Failed to remove orphan multipart upload for ${upload.key}`, e);
            }
        }

        isTruncated = result.isTruncated;
        keyMarker = result.nextKeyMarker;
        uploadIdMarker = result.nextUploadIdMarker;
    }
}


const verifyUpload = async (bucketName: string, objectKey: string, uploadId: string, parts: { part: number; etag?: string | undefined; }[]) => {
    const uploadIdExists = await minioClient.findUploadId(bucketName, objectKey);
    if (!uploadIdExists || uploadId !== uploadIdExists) {
        throw new Error("UploadId not found in minIO");
    }

    if (parts.length === 0) {
        throw new Error("No parts found");
    }

    const sortedParts = [...parts].sort((a, b) => a.part - b.part);

    for (let index = 0; index < sortedParts.length; index++) {
        const part = sortedParts[index];
        if (!part?.etag) {
            throw new Error("Missing Etag for the part: " + part?.part);
        }
        if (part?.part !== index + 1) {
            throw new Error("Invalid part for the file")
        }
    }
}