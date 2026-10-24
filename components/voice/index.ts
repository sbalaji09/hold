// Voice screens for the hold app. Routes: app/calls/[callId]/page.tsx and app/phone/page.tsx.
// Mount <AutoOpenLiveCall /> (or call useAutoOpenLiveCall) once in the shell, inside ConvexProvider.
export { AutoOpenLiveCall, LiveCallScreen, liveCallPath, useAutoOpenLiveCall, type LiveCallScreenProps } from "./LiveCall";
export { PhoneLineScreen } from "./PhoneLine";
export { useActiveCall } from "./api";
