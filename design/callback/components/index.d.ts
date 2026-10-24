import type * as React from 'react';
export type BillStatus = 'paid' | 'scheduled' | 'checking' | 'calling' | 'held' | 'needs-you';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'hold' | 'ask';
  size?: 'md' | 'sm';
  icon?: 'phone' | 'hold' | 'tick' | 'lock' | 'clock' | 'person';
  /** Why this can't be pressed, and who can. */
  locked?: string;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): React.ReactElement;
export interface StatusMarkProps { status: BillStatus; children?: React.ReactNode }
export declare function StatusMark(props: StatusMarkProps): React.ReactElement;
export interface EndorsementProps { kind: 'held' | 'void' | 'paid' | 'confirmed'; meta?: string; animate?: boolean; children?: React.ReactNode }
export declare function Endorsement(props: EndorsementProps): React.ReactElement;
export interface SignOffProps { state: 'signed' | 'awaiting' | 'locked'; name?: string; role?: string; time?: string; verb?: string; reason?: string }
export declare function SignOff(props: SignOffProps): React.ReactElement;
export interface GuillocheProps { size?: number; lobes?: number; strands?: number; amp?: number; className?: string; style?: React.CSSProperties }
export declare function Guilloche(props: GuillocheProps): React.ReactElement;
export interface AmountProps { /** Integer cents. */ cents: number; size?: 'md' | 'lg' }
export declare function Amount(props: AmountProps): React.ReactElement;
export interface AccountLineProps { bank?: string; routing?: string; last4: string; state?: 'verified' | 'new'; note?: string }
export declare function AccountLine(props: AccountLineProps): React.ReactElement;
export interface CiteProps { href?: string; onClick?: React.MouseEventHandler; children: React.ReactNode }
export declare function Cite(props: CiteProps): React.ReactElement;
export interface CheckRowProps { n?: number; result: 'pass' | 'fail' | 'warn'; title: string; evidence?: React.ReactNode; quote?: string; flag?: string; sources?: string[] }
export declare function CheckRow(props: CheckRowProps): React.ReactElement;
export interface LineProps { state: 'ringing' | 'connected' | 'no-answer' | 'dropped' | 'confirmed' | 'not-confirmed'; supplier: string; number: string; source?: string; elapsed?: string; note?: string; label?: string; bars?: number[] }
export declare function Line(props: LineProps): React.ReactElement;
export interface TranscriptLineProps { speaker: 'callback' | 'supplier' | 'caller'; name?: string; time: string; cite?: string; aside?: string; speaking?: boolean; children: React.ReactNode }
export declare function TranscriptLine(props: TranscriptLineProps): React.ReactElement;
export interface LogEntryProps { actor: string; agent?: boolean; time: string; why?: string; children: React.ReactNode }
export declare function LogEntry(props: LogEntryProps): React.ReactElement;
export interface InboxRowProps { from: string; subject: string; preview?: string; cents?: number; status: BillStatus; time: string; unread?: boolean; selected?: boolean; href?: string; onClick?: React.MouseEventHandler }
export declare function InboxRow(props: InboxRowProps): React.ReactElement;
declare global { interface Window { Callback: {
  Button: typeof Button; StatusMark: typeof StatusMark; Endorsement: typeof Endorsement; SignOff: typeof SignOff; Guilloche: typeof Guilloche;
  Amount: typeof Amount; AccountLine: typeof AccountLine; Cite: typeof Cite; CheckRow: typeof CheckRow; Line: typeof Line;
  TranscriptLine: typeof TranscriptLine; LogEntry: typeof LogEntry; InboxRow: typeof InboxRow;
} } }
