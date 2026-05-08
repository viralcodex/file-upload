import { createServer } from "http";
import express from "express";
import console from "console";
import { markSelectedFilesForDeletion, getUploadedFiles, startUploadSession, uploadAbortion, uploadCompletion, resumeUpload, downloadFile } from "./src/files";
import { MAX_FIZE_SIZE } from "./src/constants";
import dotenv from "dotenv";
import { getOrCreateUserId } from "./src/user";

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

app.get("/", (_, res) => {
    res.json({ message: "Hello from the Upload server!" });
});

app.post("/users", async (req, res) => {
    try {
        const userId = await getOrCreateUserId();
        return res.json({ userId });
    } catch (error) {
        console.error("Failed to create user", error);
        return res.status(500).json({ error: "Failed to create user" });
    }
});

app.get("/files", async (req, res) => {
    const userId = req.query.userId as string | undefined;
    if (userId == null) {
        return res.status(400).json({
            status: "error",
            reason: "missing userId"
        });
    }
    const files = await getUploadedFiles(userId);

    return res.json(files);
});


app.post("/upload/init", async (req, res) => {
    const { userId, fileName, fileSize, contentType } = req.body;

    if (fileSize > MAX_FIZE_SIZE || fileSize < 0) {
        return res.status(400).json({ error: "Invalid File Size" });
    }
    if (userId == null || fileName == null || fileSize == null || contentType == null) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const session = await startUploadSession(userId, fileName, fileSize, contentType);
        return res.json(session);
    } catch (error) {
        console.error("Failed to initialize upload", error);
        return res.status(500).json({ error: "Failed to initialize upload" });
    }
});

app.post("/upload/resume", async (req, res) => {
    const { userId, uploadId, fileName, fileSize, contentType } = req.body;

    if (fileSize > MAX_FIZE_SIZE || fileSize < 0) {
        return res.status(400).json({ error: "Invalid File Size" });
    }
    if (userId == null || uploadId == null || fileName == null || fileSize == null || contentType == null) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const response = await resumeUpload(userId, uploadId, fileName, fileSize, contentType);
        return res.json(response);
    } catch (error) {
        const reason = error instanceof Error ? error.message : "Failed to resume upload";

        if (reason.startsWith("No uploads found for ID:")) {
            return res.status(404).json({
                status: "error",
                reason,
            });
        }
        if (reason === "Cannot resume this upload." || reason === "Upload metadata does not match.") {
            return res.status(409).json({
                status: "error",
                reason,
            });
        }

        return res.status(500).json({
            status: "error",
            reason,
        });
    }
});

app.post("/upload/complete", async (req, res) => {
    const { userId, uploadId, parts } = req.body;

    if (!userId || !uploadId || !Array.isArray(parts) || parts.length === 0) {
        return res.status(400).json({
            status: "error",
            reason: "userId, uploadId and parts are required"
        });
    }

    try {
        const uploadRes = await uploadCompletion(userId, uploadId, parts);
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
    const { userId, uploadId } = req.body;

    if (!uploadId || !userId) {
        return res.status(400).json({
            status: "error",
            reason: "uploadId is required"
        });
    }

    try {
        const abortRes = await uploadAbortion(userId, uploadId);
        return res.json(abortRes);
    } catch (error) {
        console.error("Failed to abort upload", error);
        return res.status(500).json({
            status: "error",
            reason: error instanceof Error ? error.message : "Failed to abort upload"
        });
    }
});

app.post("/files/download", async (req, res) => {
    const { userId, fileId } = req.body;
    
    if (!userId || !fileId) {
        return res.status(400).json({
            status: "error",
            reason: "userId and fileId are required"
        });
    }

    try {
        const downloadInfo = await downloadFile(userId, fileId);
        return res.json(downloadInfo);
    } catch (error) {
        const reason = error instanceof Error ? error.message : "Failed to download file";

        if (reason.startsWith("No uploads found for ID:")) {
            return res.status(404).json({
                status: "error",
                reason,
            });
        }

        console.error("Failed to download file", error);
        return res.status(500).json({
            status: "error",
            reason,
        });
    }
});

app.post("/files/delete", async (req, res) => {
    const { userId, filesIds } = req.body;

    if (userId == null) {
        return res.status(400).json({
            status: "error",
            reason: "missing userId"
        });
    }

    if (!Array.isArray(filesIds) || filesIds.length === 0) {
        return res.status(400).json({
            status: "error",
            reason: "filesIds must be a non-empty array"
        });
    }

    try {
        const result = await markSelectedFilesForDeletion(userId, filesIds);
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