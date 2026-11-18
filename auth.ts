// Point d'entrée du CLI Better Auth (`npx auth migrate`).
import { getAuth } from "./src/lib/auth/auth";

export const auth = getAuth();
