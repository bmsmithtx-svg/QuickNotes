import { isAuthenticationError } from "./auth";

export async function shouldRedirectAuthenticatedVisitor(requireUser: () => Promise<unknown>) {
  try {
    await requireUser();
    return true;
  } catch (error) {
    if (isAuthenticationError(error)) {
      return false;
    }

    throw error;
  }
}
