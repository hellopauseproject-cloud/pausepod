// Kretsens belöning — se supabase/circle_rewards.sql och *Kretsens belöning*
// i CLAUDE.md. Allt läses genom `get_circle_reward()` och skrivs genom tre
// RPC:er. Vem som leder räknas i SQL och aldrig här: förslagen kommer redan
// sorterade, flest ja först och äldst först vid lika.
import { supabase } from './supabase';

export const REWARD_MAX_LENGTH = 80;

export type RewardProposal = {
  id: string;
  text: string;
  proposer_id: string | null;
  proposer_name: string;
  created_at: string;
  votes: number;
  i_voted: boolean;
};

export type CircleReward = {
  /** Belöningen är påslagen i kretsen (circles.rewards_enabled). */
  enabled: boolean;
  /** Veckan förslagen och rösterna gäller (måndag, UTC). Allt börjar om när den byts. */
  week_start: string;
  /** Förslaget med flest ja (minst ett). Null när ingen sagt ja till något. */
  leader_id: string | null;
  current: { id: string; text: string } | null;
  /** Veckans bedrift är låst. */
  week_reached: boolean;
  /** Belöningen som gällde när veckan låstes — kan skilja sig från `current`. */
  unlocked_text: string | null;
  proposals: RewardProposal[];
};

export async function getCircleReward(circleId: string): Promise<CircleReward | null> {
  const { data, error } = await supabase.rpc('get_circle_reward', { p_circle_id: circleId });
  if (error) {
    console.log('[circleRewards] get error:', error.message);
    return null;
  }
  return (data as CircleReward | null) ?? null;
}

/**
 * Om något väntar på ens svar: man har ingen röst lagd, och det finns andras
 * förslag att lägga den på. En röst per person, så när den väl ligger någon
 * står ingenting och väntar — oavsett hur många förslag som kommer till.
 */
export function awaitsMyVote(reward: CircleReward | null, meId: string): boolean {
  if (!reward) return false;
  return !reward.proposals.some(p => p.i_voted)
    && reward.proposals.some(p => p.proposer_id !== meId);
}

/** En vunnen vecka i historiken — se get_circle_reward_history i SQL. */
export type RewardWeek = {
  week_start: string;
  /** Den upplåsta belöningen. Null för en vecka vunnen utan något förslag med ett ja. */
  reward: string | null;
};

export async function getCircleRewardHistory(circleId: string): Promise<RewardWeek[]> {
  const { data, error } = await supabase.rpc('get_circle_reward_history', { p_circle_id: circleId });
  if (error) {
    console.log('[circleRewards] history error:', error.message);
    return [];
  }
  return (data as RewardWeek[] | null) ?? [];
}

/**
 * "Sep 28 – Oct 4", eller "Oct 5 – 11" inom samma månad. Historiken behöver
 * månaden i gemener och slår ihop samma månad; kretsflikens "OCT 5 – OCT 11" är versal displaytext och veckan där alltid
 * den pågående.
 */
export function formatWeekSpan(weekStart: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86400000);
  const sm = months[start.getUTCMonth()], em = months[end.getUTCMonth()];
  return sm === em
    ? `${sm} ${start.getUTCDate()} – ${end.getUTCDate()}`
    : `${sm} ${start.getUTCDate()} – ${em} ${end.getUTCDate()}`;
}

export async function proposeCircleReward(circleId: string, text: string): Promise<void> {
  const { error } = await supabase.rpc('propose_circle_reward', { p_text: text, p_circle_id: circleId });
  if (error) throw error;
}

export async function toggleCircleRewardVote(rewardId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('toggle_circle_reward_vote', { p_reward_id: rewardId });
  if (error) throw error;
  return !!data;
}

export async function withdrawCircleReward(rewardId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_circle_reward', { p_reward_id: rewardId });
  if (error) throw error;
}
