import { FontAwesome, FontAwesome5, MaterialIcons, Octicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useInvite } from '../../contexts/InviteContext';
import { DEMO_FRIENDS, DEMO_SESSION_MAP, DEMO_STORIES, isDemoId, isDemoStoryId } from '../../lib/demoFriends';
import { sendPushNotification } from '../../lib/notifications';
import { supabase } from '../../lib/supabase';
import type { PauseSession, Profile } from '../../types/database';
import { Category, DEFAULT_CATEGORIES, getAllCategories, getSelectedCategories } from '../pauseLogger';

// ─── Types ────────────────────────────────────────────────────────────────────

type SupportStory = {
  id: string;
  user_id: string;
  support_type: string;
  activity: string;
  intention_id: string | null;
  personal_note: string | null;
  created_at: string;
  profile: { id: string; username: string; avatar_url: string | null } | null;
};

const SUPPORT_TYPE_LABELS: Record<string, string> = {
  tröst: 'Tröst', värme: 'Värme', närvaro: 'Närvaro', sällskap: 'Sällskap',
  empati: 'Empati', förståelse: 'Förståelse', stöd: 'Stöd', lugn: 'Lugn',
  hopp: 'Hopp', skratt: 'Skratt', pepp: 'Pepp', hejarop: 'Hejarop',
  'en knuff': 'En knuff', 'hjälp att börja': 'Hjälp att börja',
  råd: 'Råd', perspektiv: 'Perspektiv', klarhet: 'Klarhet', visdom: 'Visdom',
  strategi: 'Strategi', ärlighet: 'Ärlighet', 'reality check': 'Reality check',
  motivationstal: 'Motivationstal', predikan: 'Predikan', tillsägelse: 'Tillsägelse',
};

type IncomingRequest = {
  friendshipId: string;
  requester: Pick<Profile, 'id' | 'username' | 'avatar_url'>;
};

type Friend = Pick<Profile, 'id' | 'username' | 'avatar_url' | 'show_stats' | 'is_pausing'> & {
  friendshipId: string;
};

type SessionMap = Record<string, {
  active: PauseSession | null;
  latest: PauseSession | null;
}>;

type SharedInvite = {
  sessionId: string;
  sharedSessionId: string;
  inviter: { id: string; username: string; avatar_url: string | null };
};

type ProfileCardData = {
  id: string; username: string; avatar_url: string | null;
  kind: 'request';
  friendshipId: string;
  onAccept: () => void;
  onDecline: () => void;
} | {
  id: string; username: string; avatar_url: string | null;
  kind: 'friend';
  statusText: string | null;
  isPausing: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function friendStatusText(friend: Friend, sessionMap: SessionMap): string | null {
  if (friend.is_pausing) return 'pausar nu';
  const entry = sessionMap[friend.id];
  if (!friend.show_stats || !entry?.latest?.ended_at) return null;
  const minutesAgo = Math.floor(
    (Date.now() - new Date(entry.latest.ended_at).getTime()) / 60000
  );
  if (minutesAgo < 1) return 'pausade nyss';
  if (minutesAgo < 60) return `senast pausade ${minutesAgo} min sedan`;
  const hoursAgo = Math.floor(minutesAgo / 60);
  return `senast pausade ${hoursAgo} h sedan`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ username, avatarUrl, size = 44 }: { username: string; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarLetter, { fontSize: size * 0.38 }]}>
        {username[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

function ProfileCard({ data, onClose }: { data: ProfileCardData; onClose: () => void }) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.cardBackdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Avatar username={data.username} avatarUrl={data.avatar_url} size={80} />
          <Text style={styles.cardName}>{data.username}</Text>
          {data.kind === 'friend' && data.statusText && (
            <Text style={[styles.cardStatus, data.isPausing && styles.cardStatusActive]}>
              {data.statusText}
            </Text>
          )}
          {data.kind === 'request' && (
            <Text style={styles.cardStatus}>Vill lägga till dig</Text>
          )}
          {data.kind === 'request' && (
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.acceptBtn} onPress={() => { data.onAccept(); onClose(); }} activeOpacity={0.8}>
                <Text style={styles.acceptBtnText}>Acceptera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.declineBtn} onPress={() => { data.onDecline(); onClose(); }} activeOpacity={0.8}>
                <Text style={styles.declineBtnText}>Avböj</Text>
              </TouchableOpacity>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Intentionskarusell — gemensam för båda modaler
const CARD_W = 58;
const CARD_GAP = 8;

function CategoryCarousel({
  categories,
  selected,
  onSelect,
}: {
  categories: Category[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (categories.length === 0) return null;
  return (
    <ScrollView
      horizontal
      snapToInterval={CARD_W + CARD_GAP}
      decelerationRate="fast"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.carouselContent}
    >
      {categories.map(cat => {
        const active = selected === cat.id;
        return (
          <TouchableOpacity
            key={cat.id}
            style={[styles.carouselCard, active && styles.carouselCardActive]}
            onPress={() => onSelect(active ? null : cat.id)}
            activeOpacity={0.75}
          >
            <Text style={styles.carouselEmoji}>{cat.emoji}</Text>
            <Text style={[styles.carouselCardLabel, active && styles.carouselCardLabelActive]}>
              {cat.label.length > 10 ? cat.label.slice(0, 7) + '...' : cat.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// Bekräftelsemodal innan inbjudan skickas
function ConfirmInviteModal({
  friend,
  categories,
  onConfirm,
  onCancel,
}: {
  friend: Friend;
  categories: Category[];
  onConfirm: (category: string | null) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState<Category[]>(categories);
  const [showAdd, setShowAdd] = useState(false);
  const [allCats, setAllCats] = useState<Category[]>([]);

  useEffect(() => { getAllCategories().then(setAllCats); }, []);

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.cardBackdrop} onPress={onCancel}>
        <Pressable style={styles.confirmModal} onPress={() => {}}>
          <View style={styles.confirmIconRow}>
            <FontAwesome name="pause" size={18} color="#2e86de" />
          </View>
          <Text style={styles.confirmTitle}>Bjud in {friend.username}?</Text>
          <View style={styles.intentionLabelRow}>
            <Text style={styles.acceptInviteSub}>Vad tänker du göra? (valfritt)</Text>
            <TouchableOpacity style={styles.addIntentionBtn} onPress={() => setShowAdd(true)}>
              <MaterialIcons name="add" size={14} color="#555" />
            </TouchableOpacity>
          </View>
          {localCategories.length > 0 && (
            <CategoryCarousel categories={localCategories} selected={selected} onSelect={setSelected} />
          )}
          <TouchableOpacity style={[styles.confirmSendBtn, { marginTop: 4 }]} onPress={() => onConfirm(selected)} activeOpacity={0.85}>
            <Text style={styles.confirmSendText}>Bjud in</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmCancelBtn} onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.confirmCancelText}>Avbryt</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>

      <Modal transparent animationType="fade" visible={showAdd} onRequestClose={() => setShowAdd(false)}>
        <Pressable style={styles.cardBackdrop} onPress={() => setShowAdd(false)}>
          <Pressable style={styles.addCatModal} onPress={() => {}}>
            <Text style={styles.addCatTitle}>LÄGG TILL INTENTION</Text>
            <View style={styles.addCatGrid}>
              {allCats.filter(c => !localCategories.find(lc => lc.id === c.id)).map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  style={styles.addCatChip}
                  onPress={() => {
                    setLocalCategories(prev => [...prev, cat]);
                    setSelected(cat.id);
                    setShowAdd(false);
                  }}
                >
                  <Text style={styles.addCatEmoji}>{cat.emoji}</Text>
                  <Text style={styles.addCatLabel}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {allCats.filter(c => !localCategories.find(lc => lc.id === c.id)).length === 0 && (
              <Text style={styles.addCatEmpty}>Alla intentioner är redan tillagda.</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

// Inkommande pausinbjudan (mottagarens vy)
function InviteCard({
  invite,
  onAccept,
  onDecline,
}: {
  invite: SharedInvite;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.inviteCard}>
      <View style={styles.inviteTop}>
        <Avatar username={invite.inviter.username} avatarUrl={invite.inviter.avatar_url} size={48} />
        <View style={styles.inviteTextBlock}>
          <Text style={styles.inviteTitle} numberOfLines={1}>
            {invite.inviter.username}
          </Text>
          <Text style={styles.inviteSubtitle}>vill pausa med dig — är du redo nu?</Text>
        </View>
      </View>
      <View style={styles.inviteActions}>
        <TouchableOpacity style={styles.pauseNowBtn} onPress={onAccept} activeOpacity={0.85}>
          <FontAwesome name="pause" size={11} color="#fff" />
          <Text style={styles.pauseNowText}>Ja, jag pausar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.notNowBtn} onPress={onDecline} activeOpacity={0.7}>
          <Text style={styles.notNowText}>Inte just nu</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Widget som visas när inbjudaren har minimerat väntan-skärmen
function OutgoingInviteWidget({
  friendName,
  status,
  onCancel,
  onDismiss,
}: {
  friendName: string;
  status: 'waiting' | 'declined';
  onCancel: () => void;
  onDismiss: () => void;
}) {
  if (status === 'declined') {
    return (
      <View style={styles.outgoingWidget}>
        <View style={styles.outgoingWidgetLeft}>
          <FontAwesome5 name="leaf" size={13} color="#5a8a6a" />
          <Text style={styles.outgoingWidgetText}>
            {friendName} kunde inte just nu.
          </Text>
        </View>
        <TouchableOpacity onPress={onDismiss} activeOpacity={0.7} style={styles.outgoingDismissBtn}>
          <Text style={styles.outgoingDismissText}>OK</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.outgoingWidget}>
      <View style={styles.outgoingWidgetLeft}>
        <FontAwesome5 name="user-clock" size={13} color="#2e86de" />
        <Text style={styles.outgoingWidgetText} numberOfLines={1}>
          Väntar på {friendName}…
        </Text>
      </View>
      <TouchableOpacity onPress={onCancel} activeOpacity={0.7} style={styles.outgoingCancelBtn}>
        <Text style={styles.outgoingCancelText}>Avbryt</Text>
      </TouchableOpacity>
    </View>
  );
}

function RequestRow({
  req, onAccept, onDecline, onProfilePress,
}: {
  req: IncomingRequest;
  onAccept: () => void;
  onDecline: () => void;
  onProfilePress: () => void;
}) {
  return (
    <View style={styles.requestRow}>
      <TouchableOpacity onPress={onProfilePress} activeOpacity={0.7}>
        <Avatar username={req.requester.username} avatarUrl={req.requester.avatar_url} />
      </TouchableOpacity>
      <TouchableOpacity style={{ flex: 1 }} onPress={onProfilePress} activeOpacity={0.7}>
        <Text style={styles.rowUsername} numberOfLines={1}>{req.requester.username}</Text>
      </TouchableOpacity>
      <View style={styles.requestActions}>
        <TouchableOpacity style={styles.acceptBtn} onPress={onAccept} activeOpacity={0.8}>
          <Text style={styles.acceptBtnText}>Acceptera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.declineBtn} onPress={onDecline} activeOpacity={0.8}>
          <Text style={styles.declineBtnText}>Avböj</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function FriendRow({
  friend, sessionMap, onProfilePress, onInvite, onWrapped,
}: {
  friend: Friend;
  sessionMap: SessionMap;
  onProfilePress: () => void;
  onInvite: () => void;
  onWrapped: () => void;
}) {
  const statusText = friendStatusText(friend, sessionMap);
  const isPausing = friend.is_pausing;

  return (
    <View style={styles.friendRow}>
      <TouchableOpacity style={styles.friendLeft} onPress={onProfilePress} activeOpacity={0.75}>
        <View style={styles.friendAvatar}>
          <Avatar username={friend.username} avatarUrl={friend.avatar_url} />
          {isPausing && <View style={styles.pausingDot} />}
        </View>
        <View style={styles.friendInfo}>
          <Text style={styles.rowUsername} numberOfLines={1}>{friend.username}</Text>
          {statusText && (
            <Text style={[styles.statusText, isPausing && styles.statusTextActive]}>
              {statusText}
            </Text>
          )}
        </View>
      </TouchableOpacity>

      <View style={styles.friendActions}>
        {friend.show_stats && (
          <TouchableOpacity style={styles.iconBtn} onPress={onWrapped} activeOpacity={0.7}>
            <MaterialIcons name="insights" size={18} color="#5a7fa8" />
          </TouchableOpacity>
        )}
        {!isPausing && (
          <TouchableOpacity style={styles.iconBtn} onPress={onInvite} activeOpacity={0.7}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 3 }}>
              <FontAwesome5 name="pause" size={12} color="#5a7fa8" />
              <FontAwesome5 name="plus" size={7} color="#5a7fa8" />
            </View>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// Modal för intention-val när mottagaren accepterar inbjudan
function AcceptInviteModal({
  invite,
  categories,
  onConfirm,
  onCancel,
}: {
  invite: SharedInvite;
  categories: Category[];
  onConfirm: (category: string | null) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState<Category[]>(categories);
  const [showAdd, setShowAdd] = useState(false);
  const [allCats, setAllCats] = useState<Category[]>([]);

  useEffect(() => { getAllCategories().then(setAllCats); }, []);

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.cardBackdrop} onPress={onCancel}>
        <Pressable style={styles.acceptInviteModal} onPress={() => {}}>
          <Avatar username={invite.inviter.username} avatarUrl={invite.inviter.avatar_url} size={60} />
          <Text style={styles.acceptInviteTitle}>
            Pausa med {invite.inviter.username}
          </Text>
          <View style={styles.intentionLabelRow}>
            <Text style={styles.acceptInviteSub}>Vad tänker du göra? (valfritt)</Text>
            <TouchableOpacity style={styles.addIntentionBtn} onPress={() => setShowAdd(true)}>
              <MaterialIcons name="add" size={14} color="#555" />
            </TouchableOpacity>
          </View>
          {localCategories.length > 0 && (
            <CategoryCarousel categories={localCategories} selected={selected} onSelect={setSelected} />
          )}
          <TouchableOpacity style={styles.confirmSendBtn} onPress={() => onConfirm(selected)} activeOpacity={0.85}>
            <Text style={styles.confirmSendText}>Starta pausen</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmCancelBtn} onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.confirmCancelText}>Avbryt</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>

      <Modal transparent animationType="fade" visible={showAdd} onRequestClose={() => setShowAdd(false)}>
        <Pressable style={styles.cardBackdrop} onPress={() => setShowAdd(false)}>
          <Pressable style={styles.addCatModal} onPress={() => {}}>
            <Text style={styles.addCatTitle}>LÄGG TILL INTENTION</Text>
            <View style={styles.addCatGrid}>
              {allCats.filter(c => !localCategories.find(lc => lc.id === c.id)).map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  style={styles.addCatChip}
                  onPress={() => {
                    setLocalCategories(prev => [...prev, cat]);
                    setSelected(cat.id);
                    setShowAdd(false);
                  }}
                >
                  <Text style={styles.addCatEmoji}>{cat.emoji}</Text>
                  <Text style={styles.addCatLabel}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {allCats.filter(c => !localCategories.find(lc => lc.id === c.id)).length === 0 && (
              <Text style={styles.addCatEmpty}>Alla intentioner är redan tillagda.</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

// ─── Story bubbles (horisontell rad) ─────────────────────────────────────────

const BUBBLE_D = 68;

function StoryBubble({
  username, avatarUrl, ringColor, dimmed, onPress, isPlus,
}: {
  username: string; avatarUrl?: string | null;
  ringColor: string; dimmed?: boolean;
  onPress: () => void; isPlus?: boolean;
}) {
  const firstName = username.split(' ')[0];
  return (
    <TouchableOpacity style={bubbleStyles.wrap} onPress={onPress} activeOpacity={0.75}>
      <View style={[bubbleStyles.ring, { borderColor: dimmed ? 'rgba(162,155,254,0.2)' : ringColor }]}>
        {isPlus ? (
          <View style={bubbleStyles.plusCircle}>
            <FontAwesome5 name="plus" size={22} color="#a29bfe" />
          </View>
        ) : (
          <View style={{ opacity: dimmed ? 0.45 : 1 }}>
            <Avatar username={username} avatarUrl={avatarUrl} size={BUBBLE_D} />
          </View>
        )}
        {dimmed && (
          <View style={bubbleStyles.checkBadge}>
            <FontAwesome5 name="check" size={8} color="#fff" />
          </View>
        )}
      </View>
      <Text style={[bubbleStyles.name, dimmed && { opacity: 0.45 }]} numberOfLines={1}>
        {isPlus ? 'Be om stöd' : firstName}
      </Text>
    </TouchableOpacity>
  );
}

function StoryRow({
  myStory, stories, respondedMap, onBubblePress, onPlusPress,
}: {
  myStory: SupportStory | null;
  stories: SupportStory[];
  respondedMap: Record<string, { id: string; deliveredAt: string | null }>;
  onBubblePress: (index: number) => void;
  onPlusPress: () => void;
}) {
  const hasActive = myStory || stories.length > 0;
  return (
    <View style={bubbleStyles.section}>
      {hasActive && <Text style={bubbleStyles.sectionLabel}>Motivera varandra</Text>}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={bubbleStyles.row}
      >
        {myStory ? (
          <StoryBubble
            username={myStory.profile?.username ?? '?'}
            avatarUrl={myStory.profile?.avatar_url}
            ringColor="#7aaa8a"
            onPress={() => onBubblePress(0)}
          />
        ) : (
          <StoryBubble
            username="Be om stöd"
            ringColor="#a29bfe"
            isPlus
            onPress={onPlusPress}
          />
        )}
        {stories.map((story, i) => (
          <StoryBubble
            key={story.id}
            username={story.profile?.username ?? '?'}
            avatarUrl={story.profile?.avatar_url}
            ringColor="#a29bfe"
            dimmed={!!respondedMap[story.id]}
            onPress={() => onBubblePress((myStory ? 1 : 0) + i)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function StoryDetailModal({
  items, initialIndex, myUserId,
  respondedMap, onUndoResponse,
  onRespondText, onRespondVoice, onRespondVideo,
  onDeactivateOwn, onClose,
}: {
  items: SupportStory[];
  initialIndex: number;
  myUserId: string;
  respondedMap: Record<string, { id: string; deliveredAt: string | null }>;
  onUndoResponse: (storyId: string) => Promise<void>;
  onRespondText: (storyId: string, ownerName: string) => void;
  onRespondVoice: (storyId: string, ownerName: string) => void;
  onRespondVideo: (storyId: string, ownerName: string) => void;
  onDeactivateOwn: () => Promise<void>;
  onClose: () => void;
}) {
  const listRef = useRef<FlatList<SupportStory>>(null);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const SCREEN_W = Dimensions.get('window').width;

  const renderItem = ({ item }: { item: SupportStory }) => {
    const isOwn = item.user_id === myUserId;
    const typeLabels = item.support_type
      ? item.support_type.split(',').map(id => SUPPORT_TYPE_LABELS[id.trim()] ?? id.trim())
      : [];
    const responded = !!respondedMap[item.id];
    const responseDelivered = respondedMap[item.id]?.deliveredAt != null;
    const name = item.profile?.username ?? '?';
    const intentionEmoji = item.intention_id
      ? DEFAULT_CATEGORIES.find(c => c.id === item.intention_id)?.emoji
      : undefined;

    return (
      <View style={[storyModalStyles.page, { width: SCREEN_W }]}>
        <View style={storyModalStyles.inner}>
          <View style={storyModalStyles.avatarWrap}>
            <View style={[storyModalStyles.avatarRing, { borderColor: isOwn ? '#7aaa8a' : '#a29bfe' }]}>
              <Avatar username={name} avatarUrl={item.profile?.avatar_url} size={88} />
            </View>
          </View>

          <Text style={storyModalStyles.nameText}>{name}</Text>


          <View style={storyModalStyles.ownContentCard}>
            {intentionEmoji && (
              <Text style={storyModalStyles.bigEmoji}>{intentionEmoji}</Text>
            )}
            {!!item.activity && (
              <>
                <Text style={storyModalStyles.activityPrefix}>Behöver motivation för att</Text>
                <Text style={storyModalStyles.activityLabel}>{item.activity}</Text>
              </>
            )}
            {typeLabels.length > 0 && (
              <View style={storyModalStyles.typePillRow}>
                {typeLabels.map(label => (
                  <View key={label} style={storyModalStyles.typePill}>
                    <Text style={storyModalStyles.typePillText}>{label}</Text>
                  </View>
                ))}
              </View>
            )}
            {!!item.personal_note && (
              <>
                <View style={storyModalStyles.ownCardDivider} />
                <Text style={storyModalStyles.noteText}>"{item.personal_note}"</Text>
              </>
            )}
          </View>

          {isOwn ? (
            <TouchableOpacity style={storyModalStyles.deactivateBtn} onPress={onDeactivateOwn} activeOpacity={0.8}>
              <FontAwesome5 name="times-circle" size={13} color="#ff7675" />
              <Text style={storyModalStyles.deactivateBtnText}>Ta bort förfrågan</Text>
            </TouchableOpacity>
          ) : responded ? (
            <View>
              <View style={storyModalStyles.respondedRow}>
                <Text style={storyModalStyles.respondedText}>✓  Skickat</Text>
                {!responseDelivered && (
                  <TouchableOpacity onPress={() => onUndoResponse(item.id)} activeOpacity={0.7}>
                    <Text style={storyModalStyles.undoText}>Ångra</Text>
                  </TouchableOpacity>
                )}
              </View>
              {isDemoStoryId(item.id) && (
                <Text style={storyModalStyles.demoNote}>({name} är en demovän och kan inte ta emot meddelanden)</Text>
              )}
            </View>
          ) : (
            <View style={storyModalStyles.respondBtns}>
              <TouchableOpacity style={storyModalStyles.respondBtn} onPress={() => onRespondText(item.id, name)} activeOpacity={0.8}>
                <FontAwesome5 name="comment-alt" size={13} color="#c4b5fd" />
                <Text style={storyModalStyles.respondBtnText}>Text</Text>
              </TouchableOpacity>
              <TouchableOpacity style={storyModalStyles.respondBtn} onPress={() => onRespondVoice(item.id, name)} activeOpacity={0.8}>
                <FontAwesome5 name="microphone" size={13} color="#c4b5fd" />
                <Text style={storyModalStyles.respondBtnText}>Röst</Text>
              </TouchableOpacity>
              <TouchableOpacity style={storyModalStyles.respondBtn} onPress={() => onRespondVideo(item.id, name)} activeOpacity={0.8}>
                <FontAwesome5 name="video" size={13} color="#c4b5fd" />
                <Text style={storyModalStyles.respondBtnText}>Video</Text>
              </TouchableOpacity>
            </View>
          )}

        </View>
      </View>
    );
  };

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={storyModalStyles.container}>
        {/* Stänger-knapp */}
        <TouchableOpacity style={storyModalStyles.closeBtn} onPress={onClose} activeOpacity={0.7}>
          <FontAwesome5 name="times" size={18} color="rgba(255,255,255,0.5)" />
        </TouchableOpacity>

        {/* Dots-indikator */}
        {items.length > 1 && (
          <View style={storyModalStyles.dotsRow}>
            {items.map((_, i) => (
              <View key={i} style={[storyModalStyles.dot, i === currentIndex && storyModalStyles.dotActive]} />
            ))}
          </View>
        )}

        <FlatList
          ref={listRef}
          data={items}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
          onMomentumScrollEnd={e => {
            setCurrentIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
          }}
        />
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FriendsScreen() {
  const { user } = useAuth();
  const { outgoingInvite, inviteStatus, setOutgoingInvite, clearInvite, cancelInvite } = useInvite();
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [sessionMap, setSessionMap] = useState<SessionMap>({});
  const [invites, setInvites] = useState<SharedInvite[]>([]);
  const [acceptingInvite, setAcceptingInvite] = useState<SharedInvite | null>(null);
  const [inviteCategories, setInviteCategories] = useState<Category[]>([]);
  const [confirmInviteFriend, setConfirmInviteFriend] = useState<Friend | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileCard, setProfileCard] = useState<ProfileCardData | null>(null);
  const [showInsightModal, setShowInsightModal] = useState(false);
  const [insightText, setInsightText] = useState('');
  const [insightSaved, setInsightSaved] = useState(false);
  const [insightSaving, setInsightSaving] = useState(false);
  const friendIdsRef = useRef<string[]>([]);
  const [stories, setStories] = useState<SupportStory[]>([]);
  const [myStory, setMyStory] = useState<SupportStory | null>(null);
  const [respondedMap, setRespondedMap] = useState<Record<string, { id: string; deliveredAt: string | null }>>({}); // storyId → { id, deliveredAt }
  const [storyModalIndex, setStoryModalIndex] = useState<number | null>(null);
  const [demoResponded, setDemoResponded] = useState<Set<string>>(new Set());
  const pendingNavRef = useRef<(() => void) | null>(null);

  // Demo-vänner — läggs bara till vid rendering, rör aldrig Supabase
  const displayFriends = useMemo(() => [...friends, ...DEMO_FRIENDS], [friends]);
  const displaySessionMap = useMemo(() => ({ ...sessionMap, ...DEMO_SESSION_MAP }), [sessionMap]);
  const displayStories = useMemo(() => [...stories, ...DEMO_STORIES], [stories]);
  const displayResponded = useMemo(() => {
    const demoEntries = Object.fromEntries(
      [...demoResponded].map(id => [id, { id, deliveredAt: null as string | null }])
    );
    return { ...respondedMap, ...demoEntries };
  }, [respondedMap, demoResponded]);

  // Kör pending navigation efter att story-modalen stängt
  useEffect(() => {
    if (storyModalIndex === null && pendingNavRef.current) {
      const nav = pendingNavRef.current;
      pendingNavRef.current = null;
      const t = setTimeout(nav, 350);
      return () => clearTimeout(t);
    }
  }, [storyModalIndex]);

  // ── Sessions ──────────────────────────────────────────────────────────────

  const fetchSessions = useCallback(async (ids: string[]) => {
    if (ids.length === 0) { setSessionMap({}); return; }
    const { data } = await supabase
      .from('pause_sessions')
      .select('id, user_id, started_at, ended_at, duration_seconds, intention, is_shared, shared_session_id, invite_status, with_pod, completed, box_id, box_seq')
      .in('user_id', ids)
      .order('started_at', { ascending: false });

    const map: SessionMap = {};
    for (const id of ids) {
      const userSessions = (data ?? []).filter(s => s.user_id === id);
      map[id] = {
        active: userSessions.find(s => !s.ended_at && s.started_at && !['pending', 'sent', 'declined'].includes(s.invite_status as string)) ?? null,
        latest: userSessions.find(s => !!s.ended_at) ?? null,
      };
    }
    setSessionMap(map);
  }, []);

  // ── Friends & requests ────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    if (!user) return;

    const { data: reqData } = await supabase
      .from('friendships')
      .select('id, requester_id, requester:profiles!requester_id(id, username, avatar_url)')
      .eq('receiver_id', user.id)
      .eq('status', 'pending');

    setRequests(
      (reqData ?? []).map((r: any) => ({
        friendshipId: r.id,
        requester: r.requester ?? { id: r.requester_id, username: 'Okänd användare', avatar_url: null },
      }))
    );

    const { data: friendData } = await supabase
      .from('friendships')
      .select(`
        id, requester_id, receiver_id,
        requester:profiles!requester_id(id, username, avatar_url, show_stats, is_pausing),
        receiver:profiles!receiver_id(id, username, avatar_url, show_stats, is_pausing)
      `)
      .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .eq('status', 'accepted');

    const friendList: Friend[] = (friendData ?? [])
      .filter((f: any) => {
        const isRequester = f.requester_id === user.id;
        return isRequester ? f.receiver != null : f.requester != null;
      })
      .map((f: any) => {
        const isRequester = f.requester_id === user.id;
        const profile = isRequester ? f.receiver : f.requester;
        return { ...profile, friendshipId: f.id };
      });

    setFriends(friendList);
    const ids = friendList.map(f => f.id);
    friendIdsRef.current = ids;
    await fetchSessions(ids);
  }, [user, fetchSessions]);

  // ── Shared pause invites ──────────────────────────────────────────────────

  const fetchInvites = useCallback(async () => {
    if (!user) return;

    // Mina väntande inbjudningar (invite_status = 'pending', jag är mottagare)
    const { data: pending } = await supabase
      .from('pause_sessions')
      .select('id, shared_session_id')
      .eq('user_id', user.id)
      .eq('is_shared', true)
      .eq('invite_status', 'pending')
      .is('ended_at', null);

    if (!pending || pending.length === 0) { setInvites([]); return; }

    const results: SharedInvite[] = [];
    for (const p of pending) {
      if (!p.shared_session_id) continue;

      // Hitta inbjudaren — den andra sessionen med samma shared_session_id
      const { data: partnerRows } = await supabase
        .from('pause_sessions')
        .select('user_id')
        .eq('shared_session_id', p.shared_session_id)
        .neq('user_id', user.id)
        .limit(1);

      const partnerId = partnerRows?.[0]?.user_id;
      if (!partnerId) continue;

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .eq('id', partnerId)
        .maybeSingle();

      if (profile) {
        results.push({ sessionId: p.id, sharedSessionId: p.shared_session_id, inviter: profile });
      }
    }
    setInvites(results);
  }, [user]);

  // ── Support stories ───────────────────────────────────────────────────────

  const fetchStories = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('support_stories')
      .select('id, user_id, support_type, activity, intention_id, personal_note, created_at, profile:profiles!user_id(id, username, avatar_url)')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    const all = ((data ?? []) as any[]).map(s => ({
      ...s,
      profile: Array.isArray(s.profile) ? (s.profile[0] ?? null) : (s.profile ?? null),
    })) as SupportStory[];
    setMyStory(all.find(s => s.user_id === user.id) ?? null);
    setStories(all.filter(s => s.user_id !== user.id));

    if (all.length > 0) {
      const { data: myResponses } = await supabase
        .from('support_responses')
        .select('id, story_id, delivered_at')
        .eq('sender_id', user.id)
        .in('story_id', all.map(s => s.id));

      const map: Record<string, { id: string; deliveredAt: string | null }> = {};
      for (const r of (myResponses ?? [])) map[r.story_id] = { id: r.id, deliveredAt: r.delivered_at };
      setRespondedMap(map);
    }
  }, [user]);

  // Skicka inbjudan (efter bekräftelse i modalen)
  const sendInvite = async (friend: Friend, category: string | null) => {
    if (!user) return;
    setConfirmInviteFriend(null);

    if (isDemoId(friend.id)) {
      Alert.alert('Demo-vän', `${friend.username} är en demo-vän och kan inte pausa med dig i den här versionen.`);
      return;
    }

    const sharedSessionId = generateUUID();

    const { error } = await supabase.rpc('create_shared_pause_invite', {
      p_my_id:     user.id,
      p_friend_id: friend.id,
      p_shared_id: sharedSessionId,
    });

    if (error) {
      console.error('sendInvite RPC error:', error.message, error.details);
      return;
    }

    setOutgoingInvite({ sharedSessionId, friendName: friend.username, category });

    router.push({
      pathname: '/pause-invite-waiting',
      params: {
        sharedSessionId,
        friendName: friend.username,
        friendAvatarUrl: friend.avatar_url ?? '',
      },
    } as never);
  };

  // Acceptera inbjudan (mottagaren) med vald kategori
  const acceptInvite = async (invite: SharedInvite, category: string | null) => {
    const now = new Date().toISOString();

    await supabase.rpc('accept_shared_pause', {
      p_shared_id: invite.sharedSessionId,
      p_now: now,
    });

    // Skicka push-notis till inbjudaren
    const { data: inviterProfile } = await supabase
      .from('profiles')
      .select('push_token, username')
      .eq('id', invite.inviter.id)
      .maybeSingle();

    if (inviterProfile?.push_token) {
      const myUsername = user?.email?.split('@')[0] ?? invite.inviter.username;
      const { data: myProfile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user!.id)
        .maybeSingle();
      const displayName = myProfile?.username ?? myUsername;

      sendPushNotification(
        inviterProfile.push_token,
        `${displayName} har accepterat din paus`,
        'Klicka för att starta',
        {
          screen: 'pausing',
          sharedSessionId: invite.sharedSessionId,
          sharedWithName: displayName,
          category: category ?? '',
        }
      );
    }

    setInvites(prev => prev.filter(i => i.sessionId !== invite.sessionId));
    setAcceptingInvite(null);

    router.push({
      pathname: '/pausing',
      params: {
        mode: 'session',
        category: category ?? '',
        sharedSessionId: invite.sharedSessionId,
        sharedWithName: invite.inviter.username,
      },
    } as never);
  };

  // Avböj inbjudan (mottagaren)
  const declineInvite = async (invite: SharedInvite) => {
    await supabase.rpc('decline_shared_pause', {
      p_shared_id: invite.sharedSessionId,
      p_decliner_id: user!.id,
    });
    setInvites(prev => prev.filter(i => i.sessionId !== invite.sessionId));
  };

  // ── Vänförfrågningar ──────────────────────────────────────────────────────

  const acceptRequest = async (friendshipId: string) => {
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
    fetchAll();
  };

  const declineRequest = async (friendshipId: string) => {
    await supabase.from('friendships').delete().eq('id', friendshipId);
    setRequests(prev => prev.filter(r => r.friendshipId !== friendshipId));
  };

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    getSelectedCategories().then(cats => {
      setInviteCategories(cats.length > 0 ? cats : DEFAULT_CATEGORIES);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAll(), fetchInvites(), fetchStories()]).finally(() => setLoading(false));
  }, [fetchAll, fetchInvites, fetchStories]);

  useFocusEffect(useCallback(() => { fetchStories(); }, [fetchStories]));

  // Polling — ny inbjudan dyker upp utan att användaren behöver refresha
  useFocusEffect(useCallback(() => {
    fetchInvites();
    const poll = setInterval(fetchInvites, 3000);
    return () => clearInterval(poll);
  }, [fetchInvites]));

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('profiles')
      .select('weekly_insight')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.weekly_insight) setInsightText(data.weekly_insight);
      });
  }, [user?.id]);

  const clearInsight = async () => {
    if (!user?.id) return;
    await supabase.from('profiles').update({ weekly_insight: null }).eq('id', user.id);
    setInsightText('');
    setInsightSaved(false);
  };

  const saveInsight = async () => {
    if (!user?.id || !insightText.trim() || insightSaving) return;
    setInsightSaving(true);
    await supabase
      .from('profiles')
      .update({ weekly_insight: insightText.trim() })
      .eq('id', user.id);
    setInsightSaving(false);
    setInsightSaved(true);
    setTimeout(() => setInsightSaved(false), 2500);
  };

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`friend-realtime-${user.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pause_sessions' }, (payload) => {
        const uid = (payload.new as any)?.user_id ?? (payload.old as any)?.user_id;
        if (uid === user.id) {
          fetchInvites();
        } else if (uid && friendIdsRef.current.includes(uid)) {
          fetchSessions(friendIdsRef.current);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
        const uid = (payload.new as any)?.id;
        if (uid && friendIdsRef.current.includes(uid)) {
          fetchAll();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchAll(), fetchInvites(), fetchStories()]);
    setRefreshing(false);
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#2e86de" /></View>;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#2e86de" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <FontAwesome name="pause" size={16} color="#2e86de" />
          <Text style={styles.logoText}>PAUSE POD</Text>
        </View>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Gemenskap</Text>
          <TouchableOpacity
            style={styles.insightBadge}
            onPress={() => setShowInsightModal(true)}
            activeOpacity={0.7}
          >
            <Octicons name="north-star" size={22} color="rgba(162,155,254,0.75)" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Väntande utgående inbjudan (inbjudarens minimerade vy) */}
      {outgoingInvite && inviteStatus && (
        <OutgoingInviteWidget
          friendName={outgoingInvite.friendName}
          status={inviteStatus === 'declined' ? 'declined' : 'waiting'}
          onCancel={cancelInvite}
          onDismiss={clearInvite}
        />
      )}

      {/* Inkommande pausinbjudningar (mottagarens vy) */}
      {invites.length > 0 && (
        <View style={styles.section}>
          {invites.map(invite => (
            <InviteCard
              key={invite.sessionId}
              invite={invite}
              onAccept={() => setAcceptingInvite(invite)}
              onDecline={() => declineInvite(invite)}
            />
          ))}
        </View>
      )}

      {/* Inkommande vänförfrågningar */}
      {requests.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionLabelRow}>
            <Text style={styles.sectionLabel}>INKOMMANDE</Text>
            <View style={styles.sectionBadge}>
              <Text style={styles.sectionBadgeText}>{requests.length}</Text>
            </View>
          </View>
          {requests.map(req => (
            <RequestRow
              key={req.friendshipId}
              req={req}
              onAccept={() => acceptRequest(req.friendshipId)}
              onDecline={() => declineRequest(req.friendshipId)}
              onProfilePress={() => setProfileCard({
                ...req.requester,
                kind: 'request',
                friendshipId: req.friendshipId,
                onAccept: () => acceptRequest(req.friendshipId),
                onDecline: () => declineRequest(req.friendshipId),
              })}
            />
          ))}
        </View>
      )}

      {/* Anrop — story bubbles */}
      <StoryRow
        myStory={myStory}
        stories={displayStories}
        respondedMap={displayResponded}
        onBubblePress={(index) => setStoryModalIndex(index)}
        onPlusPress={() => router.push('/support-story-create' as never)}
      />

      {/* Vänlista */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>DINA VÄNNER</Text>
        {displayFriends.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Du har inga vänner ännu.</Text>
            <TouchableOpacity onPress={() => router.push('/add-friend' as never)}>
              <Text style={styles.emptyLink}>Lägg till din första vän →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          displayFriends.map(friend => (
            <FriendRow
              key={friend.id}
              friend={friend}
              sessionMap={displaySessionMap}
              onProfilePress={() => setProfileCard({
                ...friend,
                kind: 'friend',
                statusText: friendStatusText(friend, displaySessionMap),
                isPausing: friend.is_pausing,
              })}
              onInvite={() => setConfirmInviteFriend(friend)}
              onWrapped={() => router.push({
                pathname: '/friend-wrapped',
                params: { friendId: friend.id, friendUsername: friend.username },
              } as never)}
            />
          ))
        )}
      </View>

      {/* Lägg till vän */}
      <TouchableOpacity
        style={styles.addFriendBtn}
        onPress={() => router.push('/add-friend' as never)}
        activeOpacity={0.85}
      >
        <FontAwesome5 name="user-plus" size={14} color="#2e86de" />
        <Text style={styles.addFriendText}>Lägg till vän</Text>
      </TouchableOpacity>

      {/* Bekräftelsemodal (inbjudarens vy) */}
      {confirmInviteFriend && (
        <ConfirmInviteModal
          friend={confirmInviteFriend}
          categories={inviteCategories}
          onConfirm={(category) => sendInvite(confirmInviteFriend, category)}
          onCancel={() => setConfirmInviteFriend(null)}
        />
      )}

      {/* Profilkort */}
      {profileCard && (
        <ProfileCard data={profileCard} onClose={() => setProfileCard(null)} />
      )}

      {/* Insikt-modal */}
      <Modal
        visible={showInsightModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInsightModal(false)}
      >
        {/* KAV måste vara ytterst inuti Modal för att fungera korrekt */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.insightOverlay}
        >
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowInsightModal(false)} />
          <Pressable style={styles.insightSheet} onPress={() => {}}>
            <View style={styles.insightSheetHandle} />

            <View style={styles.insightSheetHeader}>
              <View style={styles.insightSheetTitleRow}>
                <Text style={styles.insightSheetTitle}>Din inblick</Text>
                <Octicons name="north-star" size={16} color="#a29bfe" />
              </View>
              <Text style={styles.insightSheetSub}>
                Dela en tanke med dina vänner — syns i din veckovy.
              </Text>
            </View>

            <View style={styles.insightInputWrapper}>
              <TextInput
                style={styles.insightInput}
                value={insightText}
                onChangeText={t => { if (t.length <= 140) { setInsightText(t); setInsightSaved(false); } }}
                placeholder="En insikt, reflektion eller inspiration..."
                placeholderTextColor="rgba(255,255,255,0.2)"
                multiline
                maxLength={140}
                autoFocus
              />
              <Text style={styles.insightCharCount}>{insightText.length}/140</Text>
            </View>

            <TouchableOpacity
              style={[
                styles.insightSaveBtn,
                insightSaved && styles.insightSaveBtnDone,
                (!insightText.trim() || insightSaving) && styles.insightSaveBtnDisabled,
              ]}
              onPress={saveInsight}
              disabled={!insightText.trim() || insightSaving}
              activeOpacity={0.85}
            >
              {insightSaving || insightSaved ? (
                <Text style={styles.insightSaveBtnText}>
                  {insightSaving ? 'Sparar…' : '✓  Delad'}
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Octicons name="north-star" size={13} color="white" />
                  <Text style={styles.insightSaveBtnText}>Dela inblick</Text>
                </View>
              )}
            </TouchableOpacity>

            {(!!insightText.trim() || insightSaved) && (
              <TouchableOpacity onPress={clearInsight} activeOpacity={0.6} style={{ alignItems: 'center', marginTop: 8 }}>
                <Text style={styles.insightClearBtn}>Rensa inblick</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Accept invite — välj intention */}
      {acceptingInvite && (
        <AcceptInviteModal
          invite={acceptingInvite}
          categories={inviteCategories}
          onConfirm={(category) => acceptInvite(acceptingInvite, category)}
          onCancel={() => setAcceptingInvite(null)}
        />
      )}

      {/* Story detail modal */}
      {storyModalIndex !== null && (() => {
        const items: SupportStory[] = [...(myStory ? [myStory] : []), ...displayStories];
        if (items.length === 0) return null;
        return (
          <StoryDetailModal
            items={items}
            initialIndex={Math.min(storyModalIndex, items.length - 1)}
            myUserId={user!.id}
            respondedMap={displayResponded}
            onUndoResponse={async (storyId) => {
              if (isDemoStoryId(storyId)) {
                setDemoResponded(prev => { const n = new Set(prev); n.delete(storyId); return n; });
                return;
              }
              const rid = respondedMap[storyId]?.id;
              if (!rid) return;
              await supabase.from('support_responses').delete().eq('id', rid).eq('sender_id', user!.id);
              setRespondedMap(prev => { const n = { ...prev }; delete n[storyId]; return n; });
            }}
            onRespondText={(storyId, ownerName) => {
              if (isDemoStoryId(storyId)) { setDemoResponded(prev => new Set(prev).add(storyId)); return; }
              pendingNavRef.current = () => router.push({ pathname: '/support-respond-text', params: { storyId, ownerName } } as never);
              setStoryModalIndex(null);
            }}
            onRespondVoice={(storyId, ownerName) => {
              if (isDemoStoryId(storyId)) { setDemoResponded(prev => new Set(prev).add(storyId)); return; }
              pendingNavRef.current = () => router.push({ pathname: '/support-respond-voice', params: { storyId, ownerName } } as never);
              setStoryModalIndex(null);
            }}
            onRespondVideo={(storyId, ownerName) => {
              if (isDemoStoryId(storyId)) { setDemoResponded(prev => new Set(prev).add(storyId)); return; }
              pendingNavRef.current = () => router.push({ pathname: '/support-respond-video', params: { storyId, ownerName } } as never);
              setStoryModalIndex(null);
            }}
            onDeactivateOwn={async () => {
              if (!myStory) return;
              await supabase.from('support_stories').update({ is_active: false }).eq('id', myStory.id);
              setMyStory(null);
              setStoryModalIndex(null);
            }}
            onClose={() => setStoryModalIndex(null)}
          />
        );
      })()}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 48, gap: 20 },
  centered: { flex: 1, backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center' },

  // Header
  header: { gap: 48 },
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'center' },
  logoText: { fontSize: 12, fontWeight: 'bold', color: '#2e86de', letterSpacing: 4 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#ffffff' },

  // Section
  section: { gap: 4 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionBadge: {
    backgroundColor: '#2e86de', borderRadius: 10, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  sectionBadgeText: { color: '#ffffff', fontSize: 9, fontWeight: '700', lineHeight: 11 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: '#3a3a5a', letterSpacing: 2.5, marginBottom: 8 },

  // Outgoing invite widget (inbjudarens minimerade vy)
  outgoingWidget: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(46,134,222,0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(46,134,222,0.2)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  outgoingWidgetLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  outgoingWidgetText: {
    fontSize: 14,
    color: '#c8daf0',
    fontWeight: '500',
    flex: 1,
  },
  outgoingCancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  outgoingCancelText: {
    color: '#5a7fa8',
    fontSize: 12,
  },
  outgoingDismissBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(90,138,106,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(90,138,106,0.25)',
  },
  outgoingDismissText: {
    color: '#7aaa8a',
    fontSize: 12,
    fontWeight: '600',
  },

  // Invite card (mottagarens vy)
  inviteCard: {
    backgroundColor: '#0f2040',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(46,134,222,0.35)',
    padding: 16,
    gap: 14,
    marginBottom: 8,
  },
  inviteTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inviteTextBlock: { flex: 1 },
  inviteTitle: { fontSize: 15, fontWeight: '700', color: '#e8e8f0' },
  inviteSubtitle: { fontSize: 13, color: '#7ab8f5', marginTop: 3, lineHeight: 18 },
  inviteActions: { flexDirection: 'row', gap: 10 },
  pauseNowBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, backgroundColor: '#2e86de', paddingVertical: 11, borderRadius: 22,
  },
  pauseNowText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  notNowBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 11, borderRadius: 22,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  notNowText: { color: '#5a7fa8', fontSize: 14 },

  // Karusell
  carouselContent: { gap: CARD_GAP, paddingHorizontal: 12, paddingVertical: 4 },
  carouselCard: {
    width: CARD_W, paddingVertical: 8, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', gap: 4,
  },
  carouselCardActive: {
    backgroundColor: 'rgba(46,134,222,0.18)', borderColor: '#2e86de',
  },
  carouselEmoji: { fontSize: 17 },
  carouselCardLabel: {
    fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: 0, textAlign: 'center',
  },
  carouselCardLabelActive: { color: '#7ab8f5' },

  // Confirm invite modal
  confirmModal: {
    backgroundColor: '#1a1a2e',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2e2e4e',
    paddingVertical: 24,
    paddingHorizontal: 0,
    width: 320,
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
  },
  confirmIconRow: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(46,134,222,0.12)',
    borderWidth: 1, borderColor: 'rgba(46,134,222,0.3)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  confirmTitle: { fontSize: 18, fontWeight: '700', color: '#ffffff', textAlign: 'center', paddingHorizontal: 24 },
  confirmBody: {
    fontSize: 14, color: '#7a8aaa', textAlign: 'center', lineHeight: 21, paddingHorizontal: 24,
  },
  confirmSendBtn: {
    backgroundColor: '#2e86de', paddingVertical: 13, borderRadius: 24,
    alignSelf: 'stretch', alignItems: 'center', marginHorizontal: 24,
  },
  confirmSendText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  confirmCancelBtn: { paddingVertical: 10, alignSelf: 'stretch', alignItems: 'center' },
  confirmCancelText: { color: '#5a5a8a', fontSize: 14 },

  // Request row
  requestRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: '#2a2a3e', borderRadius: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#2e2e4e',
  },
  requestActions: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  acceptBtn: { backgroundColor: '#2e86de', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20 },
  acceptBtnText: { color: '#ffffff', fontSize: 11, fontWeight: '600' },
  declineBtn: {
    backgroundColor: 'transparent', paddingVertical: 5, paddingHorizontal: 10,
    borderRadius: 20, borderWidth: 1, borderColor: '#2a2a4a',
  },
  declineBtnText: { color: '#5a5a8a', fontSize: 11, fontWeight: '500' },

  // Friend row
  friendRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#2a2a3e', borderRadius: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#2e2e4e', overflow: 'hidden',
  },
  friendLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1, padding: 12 },
  friendAvatar: { position: 'relative' },
  friendInfo: { flex: 1, gap: 2 },
  friendActions: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12 },
  iconBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#2e2e5a',
  },

  // Avatar
  avatarFallback: {
    backgroundColor: '#0f0f1a', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#2e2e5a',
  },
  avatarLetter: { color: '#7a9aba', fontWeight: '700' },

  rowUsername: { fontSize: 15, fontWeight: '600', color: '#e8e8f0', letterSpacing: 0.2 },
  statusText: { fontSize: 12, color: '#3a3a6a', letterSpacing: 0.2 },
  statusTextActive: { color: '#2e86de' },
  pausingDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#2e86de', borderWidth: 2, borderColor: '#2a2a3e',
  },

  emptyState: { paddingVertical: 24, alignItems: 'center', gap: 10 },
  emptyText: { color: '#3a3a5a', fontSize: 14 },
  emptyLink: { color: '#2e86de', fontSize: 14, fontWeight: '500' },

  // Profile card modal
  cardBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: '#0f0f1a', borderRadius: 20, borderWidth: 1, borderColor: '#1e2a3a',
    paddingVertical: 32, paddingHorizontal: 32, alignItems: 'center', gap: 12, width: 260,
  },
  cardName: { fontSize: 20, fontWeight: '700', color: '#ffffff', letterSpacing: 0.2, textAlign: 'center' },
  cardStatus: { fontSize: 13, color: '#5a5a8a', textAlign: 'center' },
  cardStatusActive: { color: '#2e86de' },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 8 },

  addFriendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 15, borderRadius: 32,
    borderWidth: 1, borderColor: '#2e2e4e', backgroundColor: '#2a2a3e',
  },
  addFriendText: { color: '#2e86de', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },

  // Header insight-knapp
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  insightBadge: {
    padding: 4,
    borderRadius: 8,
  },

  // Insikt-modal (bottom sheet)
  insightOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  insightSheet: {
    backgroundColor: '#13131f',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 48,
    borderTopWidth: 1, borderColor: 'rgba(162,155,254,0.2)',
    gap: 24,
  },
  insightSheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center', marginBottom: 8,
  },
  insightSheetHeader: { gap: 6 },
  insightSheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  insightSheetTitle: { fontSize: 18, fontWeight: '700', color: '#ffffff', flex: 1 },
  insightSheetStars: { fontSize: 12, color: '#a29bfe', letterSpacing: 2 },
  insightSheetSub: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 20 },
  insightInputWrapper: {
    backgroundColor: 'rgba(162,155,254,0.06)',
    borderRadius: 16, borderWidth: 1,
    borderColor: 'rgba(162,155,254,0.25)',
    padding: 14, gap: 8, minHeight: 110,
  },
  insightInput: {
    color: 'white', fontSize: 15, lineHeight: 22,
    minHeight: 72, textAlignVertical: 'top',
  },
  insightCharCount: { color: 'rgba(255,255,255,0.22)', fontSize: 11, textAlign: 'right' },
  insightSaveBtn: {
    backgroundColor: '#a29bfe', paddingVertical: 15,
    borderRadius: 32, alignItems: 'center', marginBottom: 16,
  },
  insightSaveBtnDone: { backgroundColor: '#27ae60' },
  insightSaveBtnDisabled: { backgroundColor: 'rgba(162,155,254,0.2)' },
  insightSaveBtnText: { color: 'white', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  insightClearBtn: { color: 'rgba(255,255,255,0.3)', fontSize: 13, textDecorationLine: 'underline', letterSpacing: 0.3 },

  // Accept invite modal
  acceptInviteModal: {
    backgroundColor: '#1a1a2e',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2e2e4e',
    paddingVertical: 24,
    paddingHorizontal: 0,
    width: 320,
    alignItems: 'center',
    gap: 14,
    overflow: 'hidden',
  },
  acceptInviteTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  acceptInviteSub: {
    fontSize: 13,
    color: '#5a7fa8',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  intentionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  addIntentionBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCatModal: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 24,
    width: '88%',
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: '#2e2e4e',
  },
  addCatTitle: {
    color: '#555',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 16,
    textAlign: 'center',
  },
  addCatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-start',
  },
  addCatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2a2a3e',
    borderWidth: 1.5,
    borderColor: '#2a2a3e',
    borderRadius: 32,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  addCatEmoji: {
    fontSize: 15,
  },
  addCatLabel: {
    color: '#aaa',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  addCatEmpty: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 12,
  },
});


const bubbleStyles = StyleSheet.create({
  section: { gap: 0 },
  sectionLabel: {
    fontSize: 12, color: 'rgba(255,255,255,0.3)', letterSpacing: 1.2,
    marginBottom: 10, marginLeft: 4,
    fontWeight: '400',
  },
  row: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  wrap: {
    alignItems: 'center',
    gap: 6,
    width: BUBBLE_D + 16,
  },
  ring: {
    width: BUBBLE_D + 8,
    height: BUBBLE_D + 8,
    borderRadius: (BUBBLE_D + 8) / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusCircle: {
    width: BUBBLE_D,
    height: BUBBLE_D,
    borderRadius: BUBBLE_D / 2,
    backgroundColor: 'rgba(162,155,254,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#27ae60',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#1a1a2e',
  },
  name: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    maxWidth: BUBBLE_D + 12,
  },
});

const storyModalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0e0e1c',
  },
  closeBtn: {
    position: 'absolute',
    top: 52,
    right: 12,
    zIndex: 10,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotsRow: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    zIndex: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  dotActive: {
    backgroundColor: '#a29bfe',
    width: 18,
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 100,
    paddingBottom: 60,
  },
  inner: {
    alignItems: 'center',
    gap: 16,
    width: '100%',
  },
  avatarWrap: { marginBottom: 4 },
  avatarRing: {
    width: 88 + 10,
    height: 88 + 10,
    borderRadius: (88 + 10) / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  ownBadgePill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(122,170,138,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122,170,138,0.3)',
  },
  ownBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#7aaa8a',
    letterSpacing: 2,
  },
  ownContentCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  bigEmoji: {
    fontSize: 32,
    lineHeight: 42,
    marginBottom: 4,
  },
  activityPrefix: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: -2,
  },
  activityLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  typePillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
  },
  typePill: {
    backgroundColor: 'rgba(162,155,254,0.12)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(162,155,254,0.3)',
  },
  typePillText: {
    fontSize: 11,
    color: '#c4b5fd',
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  ownCardDivider: {
    width: 40,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 6,
  },
  requestText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    lineHeight: 24,
  },
  nameInText: {
    fontWeight: '700',
    color: '#ffffff',
  },
  accentText: {
    color: '#c4b5fd',
    fontWeight: '600',
  },
  noteText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.38)',
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 21,
  },
  respondBtns: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  respondBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(162,155,254,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(162,155,254,0.25)',
  },
  respondBtnText: {
    color: '#c4b5fd',
    fontSize: 13,
    fontWeight: '600',
  },
  respondedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 8,
  },
  respondedText: {
    fontSize: 15,
    color: '#27ae60',
    fontWeight: '600',
  },
  undoText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    textDecorationLine: 'underline',
  },
  demoNote: {
    fontSize: 12,
    fontStyle: 'italic',
    color: 'rgba(255,255,255,0.25)',
    marginTop: 6,
  },
  deactivateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,118,117,0.25)',
    backgroundColor: 'rgba(255,118,117,0.05)',
  },
  deactivateBtnText: {
    color: 'rgba(255,118,117,0.7)',
    fontSize: 12,
    fontWeight: '500',
  },
  swipeHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.2)',
    letterSpacing: 0.5,
    marginTop: 32,
  },
});
