import { createUser } from "./upload";

export const getOrCreateUserId = async () => {
    try {
        const userId = await createUser();
        return userId;
    } catch (e) {
        throw new Error("Fetching UserId failed");
    }
}