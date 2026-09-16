export type PendingSupportResponse = {
  id: string;
  storyId: string | null;
  responseType: 'text' | 'voice' | 'video';
  contentUrl: string | null;
  textContent: string | null;
  senderName: string;
  senderAvatarUrl: string | null;
};

let _pending: PendingSupportResponse | null = null;

export function setPending(r: PendingSupportResponse | null) { _pending = r; }
export function getPending(): PendingSupportResponse | null { return _pending; }
export function clearPending() { _pending = null; }
