export type Profile = {
  id: string;
  username: string;
  avatar_url: string | null;
  show_stats: boolean;
  is_pausing: boolean;
  onboarding_completed: boolean;
  created_at: string;
};

export type FriendshipStatus = 'pending' | 'accepted';

export type Friendship = {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: FriendshipStatus;
  created_at: string;
};

export type PauseSession = {
  id: string;
  user_id: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  intention: string | null;
  is_shared: boolean;
  shared_session_id: string | null;
  invite_status: 'sent' | 'pending' | 'accepted' | 'declined' | null;
  with_pod: boolean;
  completed: boolean;
  box_id: string | null;
  box_seq: string | null;
};

export type MessageType = 'voice' | 'video' | 'text';

export type PauseMessage = {
  id: string;
  sender_id: string;
  receiver_id: string;
  session_id: string | null;
  message_type: MessageType;
  content_url: string | null;
  text_content: string | null;
  delivered: boolean;
  created_at: string;
};
