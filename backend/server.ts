import { createServer } from "http";
import express from "express";
import console from "console";
import { markSelectedFilesForDeletion, getUploadedFiles, startUploadSession, uploadAbortion, uploadCompletion } from "./src/files";
import { MAX_FIZE_SIZE } from "./src/constants";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 8080;

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "http://localhost:5173");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

// Middleware to handle JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
    res.json({ message: "Hello from the Upload server!" });
});

app.post("/upload/init", async (req, res) => {
    const { fileName, fileSize, contentType } = req.body;

    if (fileSize > MAX_FIZE_SIZE) {
        return res.status(400).json({ error: "File size exceeds the maximum allowed limit of 1 GB" });
    }
    if (fileName == null || fileSize == null || contentType == null) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const session = await startUploadSession(fileName, fileSize, contentType);
        return res.json(session);
    } catch (error) {
        console.error("Failed to initialize upload", error);
        return res.status(500).json({ error: "Failed to initialize upload" });
    }
});

app.post("/upload/complete", async (req, res) => {
    const { uploadId, parts } = req.body;

    if (!uploadId || !Array.isArray(parts) || parts.length === 0) {
        return res.status(400).json({
            status: "error",
            reason: "uploadId and parts are required"
        });
    }

    try {
        const uploadRes = await uploadCompletion(uploadId, parts);
        return res.json(uploadRes);
    } catch (error) {
        console.error("Failed to complete upload", error);
        return res.status(500).json({
            status: "error",
            reason: error instanceof Error ? error.message : "Failed to complete upload"
        });
    }
})


app.post("/upload/abort", async (req, res) => {
    const { uploadId } = req.body;
    if (!uploadId) {
        return res.status(400).json({
            status: "error",
            reason: "uploadId is required"
        });
    }
    try {
        const abortRes = await uploadAbortion(uploadId);
        return res.json(abortRes);
    } catch (error) {
        console.error("Failed to abort upload", error);
        return res.status(500).json({
            status: "error",
            reason: error instanceof Error ? error.message : "Failed to abort upload"
        });
    }
});

app.get("/files", async (_, res) => {
    const files = await getUploadedFiles();

    return res.json(files);
});

app.post("/files/delete", async (req, res) => {
    const { filesIds } = req.body;

    if (!Array.isArray(filesIds) || filesIds.length === 0) {
        return res.status(400).json({
            status: "error",
            reason: "filesIds must be a non-empty array"
        });
    }

    try {
        const result = await markSelectedFilesForDeletion(filesIds);
        return res.json(result);
    } catch (error) {
        return res.status(500).json({
            status: "error",
            reason: error instanceof Error ? error.message : "Failed to mark files for deletion"
        });
    }
})
const server = createServer(app);

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});