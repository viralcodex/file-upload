import { UploadedPart, UploadTarget } from "./models";

const normalizeEtag = (etag: string | null) => etag?.replace(/^"|"$/g, "") ?? undefined;

const wait = async (delay: number, signal?: AbortSignal) => {
    if (!signal) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return;
    }

    if (signal.aborted) {
        throw new DOMException("Upload aborted", "AbortError");
    }

    await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            signal.removeEventListener("abort", abortHandler);
            resolve();
        }, delay);

        const abortHandler = () => {
            clearTimeout(timeoutId);
            reject(new DOMException("Upload aborted", "AbortError"));
        };

        signal.addEventListener("abort", abortHandler, { once: true });
    });
};

export const uploadFileChunks = async (
    file: File,
    urls: string[],
    partNumbers?: number[],
    totalChunks: number = urls.length,
    signal?: AbortSignal,
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
        }),
        signal,
    );
}

const uploadTargets = async (targets: UploadTarget[], signal?: AbortSignal): Promise<UploadedPart[]> => {
    const results = await Promise.allSettled(
        targets.map(({ chunk, url, part }) => upload(chunk, url, part, signal))
    );

    if (results.some((result) => result.status === "rejected")) {
        const abortResult = results.find(
            (result) => result.status === "rejected" && result.reason instanceof DOMException && result.reason.name === "AbortError"
        );

        if (abortResult) {
            throw (abortResult as PromiseRejectedResult).reason;
        }

        throw new Error("File upload failed, please retry after some time");
    }

    return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

//retry with exponential backoff strategy
const upload = async (chunk: Blob, url: string, partNumber: number, signal?: AbortSignal) => {
    for (let retry = 0; retry < 5; retry++) {
        if (signal?.aborted) {
            throw new DOMException("Upload aborted", "AbortError");
        }

        const jitter = Math.random() * 1000; // Random jitter to avoid thundering herd problem
        const delay = Math.pow(2, retry) * 1000 + jitter; // Exponential backoff
        await wait(delay, signal);

        try {
            const response = await fetch(url, {
                method: "PUT",
                headers: { 'Content-Type': chunk.type },
                body: chunk,
                signal,
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
            if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) {
                throw new DOMException("Upload aborted", "AbortError");
            }

            if (retry === 4) {
                throw e;
            }
            console.warn("Response failed for chunk: " + partNumber + " retrying " + (retry + 1) + " time");
        }
    }

    throw new Error(`Response failed for chunk ${partNumber}`);
}