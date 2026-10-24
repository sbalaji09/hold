import type * as React from "react";
import { MessageView } from "@/components/MessageView";
import { getPersona } from "@/lib/persona";

export default async function MessagePage({ params }: { params: Promise<{ key: string }> }): Promise<React.ReactElement> {
  const [{ key }, persona] = await Promise.all([params, getPersona()]);
  return <MessageView emailKey={decodeURIComponent(key)} actor={persona} />;
}
