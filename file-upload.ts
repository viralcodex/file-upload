import { UploadedPart, UploadTarget } from "./models";

const normalizeEtag = (etag: string | null) => etag?.replace(/^"|"$/g, "") ?? undefined;

export const uploadFileChunks = async (
    file: File,
    urls: string[],
    partNumbers?: number[],
    totalChunks: number = urls.length,
) => {
    const chunkSize = Math.ceil(file.size / totalChunks);

    return uploadTargets(
        urls.map((url, index) => {
            const part = partNumbers?.[index] ?? index + 1;
            const start = (part - 1) * chunkSize;
            const end = Math.min(start + chunkSize, file.size);

            return {
                part,
                url,
                chunk: file.slice(start, end),
            };
        })
    );
}

const uploadTargets = async (targets: UploadTarget[]): Promise<UploadedPart[]> => {
    const results = await Promise.allSettled(
        targets.map(({ chunk, url, part }) => upload(chunk, url, part))
    );

    if (results.some((result) => result.status === "rejected")) {
        throw new Error("File upload failed, please retry after some time");
    }

    return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

//retry with exponential backoff strategy
const upload = async (chunk: Blob, url: string, partNumber: number) => {
    for (let retry = 0; retry < 5; retry++) {
        const jitter = Math.random() * 1000; // Random jitter to avoid thundering herd problem
        const delay = Math.pow(2, retry) * 1000 + jitter; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        try {
            const response = await fetch(url, {
                method: "PUT",
                headers: { 'Content-Type': chunk.type },
                body: chunk
            });

            if (!response.ok) {
                if (retry === 4) {
                    throw new Error(`Response failed for chunk ${partNumber} with status ${response.status}`);
                }
                console.warn("Response failed for chunk: " + partNumber + " retrying " + (retry + 1) + " time");
                continue;
            }

            return {
                part: partNumber,
                etag: normalizeEtag(response.headers.get("etag")),
            } satisfies UploadedPart;

        } catch (e) {
            if (retry === 4) {
                throw e;
            }
            console.warn("Response failed for chunk: " + partNumber + " retrying " + (retry + 1) + " time");
        }
    }

    throw new Error(`Response failed for chunk ${partNumber}`);
}