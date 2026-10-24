"use server";
import { revalidatePath } from "next/cache";

/**
 * Something changed in Convex: re-render the open page and empty the router cache in one step.
 * A server action is atomic here; a plain router.refresh() could be dropped when the open page
 * had been served from the prefetch cache.
 */
export async function refreshTabs(): Promise<void> {
  revalidatePath("/", "layout");
}
