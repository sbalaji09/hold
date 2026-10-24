import type { Metadata } from "next";
import { PhoneLineScreen } from "@/components/voice";
import { getPersona } from "@/lib/persona";

export const metadata: Metadata = { title: "Phone line · hold" };

export default async function PhoneLinePage({ searchParams }: { searchParams: Promise<{ call?: string | string[] }> }) {
  const [persona, { call }] = await Promise.all([getPersona(), searchParams]);
  return <PhoneLineScreen actor={persona} callId={typeof call === "string" ? call : undefined} />;
}
