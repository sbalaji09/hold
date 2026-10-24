"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export type Persona = "maya" | "dev";

/** Who is signed in. A cookie, not auth: the demo needs a second laptop parked on Dev's view. */
export async function getPersona(): Promise<Persona> {
  return (await cookies()).get("hold-persona")?.value === "dev" ? "dev" : "maya";
}

export async function setPersona(formData: FormData): Promise<void> {
  const who = formData.get("who") === "dev" ? "dev" : "maya";
  (await cookies()).set("hold-persona", who, { path: "/", sameSite: "lax" });
  revalidatePath("/", "layout");
}
