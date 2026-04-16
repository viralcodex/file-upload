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
    console.log("UPLOAD", uploadId);

    const urls = await getPreSignedUrlsForChunks(objectKey, chunks, uploadId);

    return { uploadId, urls };
}

const getPreSignedUrlsForChunks = async (objectKey: string, chunks: number, uploadId: string) => {
    const bucketName = await getOrCreateBucket();

    const urls: string[] = [];

    for (let i = 0; i < chunks; i++) {
        const url = await minioClient.presignedUrl("PUT", bucketName, objectKey, 1800, { uploadId, partNumber: `${i + 1}` }); // URL valid for 30 minutes
        console.log(`Pre-signed URL for chunk ${i}: ${url}`);
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