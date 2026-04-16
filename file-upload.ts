export const uploadFileChunks = async (file: File, urls: string[]) => {
    const chunks: Blob[] = [];
    const chunkSize = Math.ceil(file.size / urls.length);

    for (let i = 0; i < urls.length; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        chunks.push(file.slice(start, end));
    }

    const chunkPromises = Promise.allSettled(
        chunks.map((chunk, index) => upload(chunk, urls[index], index))
    );

    const results = await chunkPromises;

    if (results.some((result) => result.status === "rejected")) {
        throw new Error("File upload failed, please retry after some time");
    }

    return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

//retry with exponential backoff strategy
const upload = async (chunk: Blob, url: string, chunkIndex: number) => {
    for (let retry = 0; retry < 5; retry++) {
        const jitter = retry * Math.random() * 1000; // Random jitter to avoid thundering herd problem
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
                    throw new Error(`Response failed for chunk ${chunkIndex} with status ${response.status}`);
                }
                console.warn("Response failed for chunk: " + chunkIndex + " retrying " + (retry + 1) + " time");
                continue;
            }
            return {
                part: chunkIndex + 1,
                etag: response.headers.get("Etag")
            };
        } catch (e) {
            if (retry === 4) {
                throw e;
            }
            console.warn("Response failed for chunk: " + chunkIndex + " retrying " + (retry + 1) + " time");
        }
    }
}