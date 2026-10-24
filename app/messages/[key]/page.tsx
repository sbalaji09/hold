import type * as React from "react";
import { MessageView } from "@/components/MessageView";

export default async function MessagePage({ params }: { params: Promise<{ key: string }> }): Promise<React.ReactElement> {
  const { key } = await params;
  return <MessageView emailKey={decodeURIComponent(key)} />;
}
