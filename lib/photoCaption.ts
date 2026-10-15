/**
 * Bildtextens mått och gränser, delade av den som skriver den
 * (app/support-respond-photo.tsx) och den som läser den
 * (app/support-view-photo.tsx).
 *
 * Varför en egen modul och inte två uppsättningar tal: texten brinner aldrig
 * in i fotot — den skickas bredvid bilden och läggs ovanpå först när bilden
 * visas (hela motiveringen står i supabase/support_photo.sql, vid kolumnen
 * `caption_y`). Två kopior av samma tal hade därför inte bara glidit isär i
 * koden utan i *meddelandet*: avsändaren ser en rad på ett ställe och
 * mottagaren får den på ett annat. Det är samma skäl som duration-wheel.tsx
 * och intro-chrome.tsx finns för, men med en skarpare följd.
 *
 * Samma sak gäller `resizeMode`: båda skärmarna ritar fotot med `cover` över
 * hela ytan, och `caption_y` är en andel av just den ytan. Byter den ena
 * resizeMode måste den andra byta likadant.
 */

export const CAPTION_FONT_SIZE = 17;
export const CAPTION_LINE_HEIGHT = 23;
export const CAPTION_BAND_PADDING = 14;

/** Bandet dras inte ända ut i kanten — där tar chromet över. */
export const CAPTION_MIN_Y = 0.08;
export const CAPTION_MAX_Y = 0.92;

/**
 * Taket är lågt med flit. Bildtexten är en rad över ett foto, inte ett brev;
 * textsvaret bredvid den tar 300 tecken och är platsen för det längre.
 */
export const CAPTION_MAX_LEN = 160;

/** Mitten — där bandet börjar, och där en bildtext utan sparat läge hamnar. */
export const CAPTION_DEFAULT_Y = 0.5;

/** Klampar ett läge till bandets tillåtna spann. */
export function clampCaptionY(y: number): number {
  return Math.min(CAPTION_MAX_Y, Math.max(CAPTION_MIN_Y, y));
}
