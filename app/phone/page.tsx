import type { Metadata } from "next";
import { PhoneLineScreen } from "@/components/voice";

export const metadata: Metadata = { title: "Phone line · hold" };

export default function PhoneLinePage() {
  return <PhoneLineScreen />;
}
