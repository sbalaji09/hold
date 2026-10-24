import type { Metadata } from "next";
import { PhoneLineScreen } from "@/components/voice";

export const metadata: Metadata = { title: "Phone line · hold" };

export default async function PhoneLinePage({ searchParams }: { searchParams: Promise<{ call?: string | string[] }> }) {
  const { call } = await searchParams;
  return <PhoneLineScreen callId={typeof call === "string" ? call : undefined} />;
}
