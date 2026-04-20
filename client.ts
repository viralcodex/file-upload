import { addFileAndUpload, deleteSelected, fetchFiles } from "./files";

const fileInput = document.getElementById("fileInput") as HTMLInputElement | null;
const addButton = document.getElementById("addButton") as HTMLButtonElement | null;
const deleteButton = document.getElementById("deleteButton") as HTMLButtonElement | null;
const refreshButton = document.getElementById("refreshButton") as HTMLButtonElement | null;

if (!fileInput || !addButton || !deleteButton || !refreshButton) {
    throw new Error("Needed elements not found in DOM");
}

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
