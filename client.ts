import { addFileAndUpload, deleteSelected, fetchFiles, registerUser } from "./files";

const fileInput = document.getElementById("fileInput") as HTMLInputElement | null;
const addButton = document.getElementById("addButton") as HTMLButtonElement | null;
const deleteButton = document.getElementById("deleteButton") as HTMLButtonElement | null;
const refreshButton = document.getElementById("refreshButton") as HTMLButtonElement | null;
const registerButton = document.getElementById("registerButton") as HTMLButtonElement | null;

if (!fileInput || !addButton || !deleteButton || !refreshButton || !registerButton) {
    throw new Error("Needed elements not found in DOM");
}

const actionButtons = [addButton, deleteButton, refreshButton];

const setActionsEnabled = (enabled: boolean) => {
    for (const btn of actionButtons) btn.disabled = !enabled;
};

// disable until registered
setActionsEnabled(false);

addButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) {
        addFileAndUpload(file);
        fileInput.value = "";
    }
});

deleteButton.addEventListener("click", () => deleteSelected());
refreshButton.addEventListener("click", () => fetchFiles());

registerButton.addEventListener("click", async () => {
    const userId = await registerUser();
    if (userId) {
        setActionsEnabled(true);
        registerButton.disabled = true;
        fetchFiles();
    }
});

// auto-enable if already registered
if (localStorage.getItem("user_id")) {
    setActionsEnabled(true);
    registerButton.disabled = true;
    fetchFiles();
}
