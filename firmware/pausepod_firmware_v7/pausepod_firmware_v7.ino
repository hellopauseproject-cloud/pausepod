// Pause Pod — firmware v7
// Lådan äger händelser. Appen är ett register.
// Appen startar ritualen, lådan driver och äger den sedan hela vägen.
// Utan ett set_mode från appen händer ingenting när locket stängs —
// lådan startar aldrig en paus på egen hand, eftersom den inte kan veta
// om det ens ligger en telefon i den.
//
// In: välj paus i appen → lägg i telefonen → STÄNG LOCKET → HOLD TO START
// med båda tummarna 0,9 s → bocken → PAUSE STARTED → 1 2 3 4 5 → loggan
// tonas in. Klockan startar när bocken sluts. Ingen incheckning inom
// CHECKIN_TIMEOUT_MS → tillbaka till loggan, ingen paus räknas.
// Öppnas locket innan incheckningen är klar går lådan däremot tillbaka till
// CLOSE BOX, inte till loggan: försöket lever tills en av timeouterna går ut.
//
// Ut: öppna locket → klockan fryser och siffrorna står stilla medan
// ringen krymper i 30 s. Stängs locket igen fortsätter pausen.
// Lyfts telefonen (appens phone_up) är pausen slut, completed=1.
// Rinner fristen ut avslutas den ändå, completed=0.
// Tummarna checkar inte ut — under pausen visar de bara tiden.
//
// ÄNDRAT MOT v5:
//  - Andningen interpolerar färg istället för att hoppa mellan två
//  - NVS-skrivningar sker aldrig längre i BLE-callbacken
//  - sendBLE bygger inte längre String-objekt i varje touch-event
//  - drawArc ritar bara den del av ringen som syns
//  - sprite-allokeringen kontrolleras, heap loggas
//  - död kod borttagen (time_sync-offset, setConnFast)
//
// ÄNDRAT MOT v7.0:
//  - lid_opened under CHECKING_IN går till AWAITING_LID (CLOSE BOX) i
//    stället för IDLE — försöket överlever att någon tittar i lådan
//  - phone_up under AWAITING_LID nollar phonePlaced → PLACE PHONE IN BOX,
//    så displayen följer telefonen hela vägen fram till locket

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <TFT_eSPI.h>
#include <Preferences.h>
#include <stdarg.h>
#include "pausepod_types.h"

// ─── Hårdvara ───────────────────────────────────────────────

#define TOUCH_LEFT_PIN   3
#define TOUCH_RIGHT_PIN  2
#define HALL_PIN         1
#define POWER_PIN        15
#define BATTERY_ADC_PIN  4

#define SERVICE_UUID        "12345678-1234-1234-1234-123456789012"
#define CHARACTERISTIC_UUID "abcdefab-cdef-abcd-efab-cdefabcdefab"

// ─── Beteendekonstanter ─────────────────────────────────────

const unsigned long CHECKIN_FILL_MS     = 900;    // snabbare än förr — locket är redan på
const unsigned long CHECKIN_TIMEOUT_MS  = 30000;  // ingen incheckning → tillbaka till loggan
const unsigned long THUMB_PULSE_MS      = 350;    // vågen när tummen landar
const unsigned long THUMB_RELEASE_MS    = 250;    // återgång till vilande ring
const unsigned long HINT_FADE_OUT_MS    = 250;    // HOLD TO START tonar bort
const unsigned long HINT_FADE_IN_MS     = 400;  // locket på men ingen incheckning → starta ändå
const float         RING_BACKOFF        = 1.8;
const unsigned long PHONE_WAIT_MAX_MS   = 20000;  // appen tyst så länge → visa CLOSE BOX ändå
const unsigned long AWAIT_LID_MAX_MS    = 90000;  // ingen stänger locket → tillbaka till loggan

// Startceremonin, segment för segment
const unsigned long CHECK_DRAW_MS       = 400;    // bocken ritas
const unsigned long CHECK_HOLD_MS       = 400;    // bocken står kvar
const unsigned long CHECK_FADE_MS       = 200;    // bockens uttoning, ingår i HOLD
const unsigned long STARTED_TEXT_MS     = 900;    // "PAUSE STARTED"
const int           COUNT_SECONDS       = 5;      // 1 2 3 4 5
const unsigned long COUNT_FADE_MS       = 700;    // sista siffran tonas ut
const unsigned long LOGO_FADE_MS        = 1000;   // pausikonen tonas in

const unsigned long CER_CHECK_END = CHECK_DRAW_MS + CHECK_HOLD_MS;
const unsigned long CER_TEXT_END  = CER_CHECK_END + STARTED_TEXT_MS;
const unsigned long CER_COUNT_END = CER_TEXT_END + COUNT_SECONDS * 1000UL;
const unsigned long CER_FADE_END  = CER_COUNT_END + COUNT_FADE_MS;
const unsigned long CER_END       = CER_FADE_END + LOGO_FADE_MS;
const unsigned long RESPITE_MS          = 30000;
const unsigned long MIN_SESSION_MS      = 5000;   // TESTVÄRDE — sätt 60000 innan skarp drift
const unsigned long TAP_MAX_MS          = 400;
const unsigned long STATS_TIMEOUT_MS    = 6000;
const unsigned long ENDED_SHOW_MS       = 5000;
const unsigned long CHECKPOINT_MS       = 600000;
const unsigned long ACK_TIMEOUT_MS      = 3000;
const unsigned long BATTERY_REPORT_MS   = 300000;
const unsigned long BACKLOG_START_MS    = 800;    // låt handskakningen landa först
// Appen kan inte ta emot notiser förrän den gjort klart sin service discovery
// och skrivit CCCD. Skickar vi handskakningen i samma stund som länken kommer
// upp kastar stacken den — appen fick då aldrig veta box_id, och utan box_id
// kunde den inte lagra avslutade sessioner (de tystnade ur statistiken).
const unsigned long HANDSHAKE_DELAY_MS  = 600;
const unsigned long HEAP_LOG_MS         = 30000;
const unsigned long DEBOUNCE_MS         = 40;
const int           QUEUE_SIZE          = 50;

// ─── Ljud ───────────────────────────────────────────────────

void playStartTone()   { /* TODO: MAX98357A */ }
void playCheckinTone() { /* TODO: MAX98357A */ }
void playEndTone()     { /* TODO: MAX98357A */ }

// ─── Beständig lagring ──────────────────────────────────────

Preferences prefs;

SessionRecord queueBuf[QUEUE_SIZE];
int      queueCount = 0;
uint32_t nextSeq    = 1;
String   boxId      = "";

uint64_t statTotalMs   = 0;
uint32_t statLongestMs = 0;
uint32_t statLatestMs  = 0;
uint32_t statCount     = 0;

void loadPersisted() {
  prefs.begin("pausepod", false);

  boxId = prefs.getString("box_id", "");
  if (boxId.length() == 0) {
    uint64_t chipId = ESP.getEfuseMac();
    char buf[16];
    sprintf(buf, "%04X%08X", (uint16_t)(chipId >> 32), (uint32_t)chipId);
    boxId = String(buf);
    prefs.putString("box_id", boxId);
  }

  nextSeq       = prefs.getUInt("next_seq", 1);
  statTotalMs   = prefs.getULong64("total_ms", 0);
  statLongestMs = prefs.getUInt("longest_ms", 0);
  statLatestMs  = prefs.getUInt("latest_ms", 0);
  statCount     = prefs.getUInt("count", 0);

  queueCount = prefs.getInt("q_count", 0);
  if (queueCount > QUEUE_SIZE || queueCount < 0) queueCount = 0;
  if (queueCount > 0) {
    prefs.getBytes("q_data", queueBuf, sizeof(SessionRecord) * queueCount);
  }
}

void saveQueue() {
  prefs.putInt("q_count", queueCount);
  if (queueCount > 0) {
    prefs.putBytes("q_data", queueBuf, sizeof(SessionRecord) * queueCount);
  }
}

void saveStats() {
  prefs.putULong64("total_ms", statTotalMs);
  prefs.putUInt("longest_ms", statLongestMs);
  prefs.putUInt("latest_ms", statLatestMs);
  prefs.putUInt("count", statCount);
}

void queuePush(SessionRecord r) {
  if (queueCount >= QUEUE_SIZE) {
    for (int i = 1; i < QUEUE_SIZE; i++) queueBuf[i - 1] = queueBuf[i];
    queueCount = QUEUE_SIZE - 1;
  }
  queueBuf[queueCount++] = r;
  saveQueue();
}

void queueRemoveSeq(uint32_t seq) {
  int w = 0;
  for (int i = 0; i < queueCount; i++) {
    if (queueBuf[i].seq != seq) queueBuf[w++] = queueBuf[i];
  }
  if (w == queueCount) return;   // fanns inte, ingen skrivning behövs
  queueCount = w;
  saveQueue();
}

// ─── BLE ────────────────────────────────────────────────────

BLECharacteristic* pCharacteristic;
bool deviceConnected     = false;
bool lastDeviceConnected = false;

// pCharacteristic har både NOTIFY och WRITE på samma objekt, alltså samma
// interna värde-buffert åt båda hållen. sendBLE() (huvudloopen, kärna 1)
// och onWrite() (BLE-stackens task, kärna 0) kan därför råka röra
// setValue()/getValue() på samma buffert samtidigt — en "torn read" som
// ger en läsbar men avkortad sträng, inte skräp. Detta lås serialiserar
// våra egna åtkomster mot varandra och tar bort den kollisionen.
static portMUX_TYPE bleValueMux = portMUX_INITIALIZER_UNLOCKED;

bool          backlogSending    = false;
uint32_t      backlogAwaitSeq   = 0;
unsigned long backlogSentAt     = 0;
unsigned long backlogStartAt    = 0;   // 0 = inget väntande
unsigned long handshakeAt       = 0;   // 0 = ingen väntande handskakning
unsigned long lastBatteryReport = 0;

// Sätts i BLE-callbacken, hanteras i loop(). NVS-skrivningar får
// aldrig ske i callbacken — de blockerar BLE-stacken i hundratals ms.
volatile uint32_t pendingAckSeq = 0;
volatile bool     pendingPhoneDown = false;
volatile bool     pendingSetMode   = false;
volatile bool     pendingPhoneUp   = false;

// Under AWAITING_LID: har appen sagt att telefonen ligger ner?
// Utan app är den alltid true — lådan väntar aldrig på något som
// inte kan svara.
bool phonePlaced = false;

// printf-baserad: inga String-temporärer i touch-flödet, vilket var
// det som fragmenterade heapen över tid.
void sendBLE(const char* fmt, ...) {
  if (!deviceConnected) return;
  char buf[96];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  // Se kommentaren vid bleValueMux — setValue()+notify() delar buffert med
  // onWrite()s getValue(). Håll kritisk sektion om båda tillsammans.
  portENTER_CRITICAL(&bleValueMux);
  pCharacteristic->setValue((uint8_t*)buf, strlen(buf));
  pCharacteristic->notify();
  portEXIT_CRITICAL(&bleValueMux);
  Serial.printf("→ %s\n", buf);
}

// ─── Tillstånd ──────────────────────────────────────────────

Phase phase = IDLE;

const char* phaseName(Phase p) {
  switch (p) {
    case IDLE:             return "idle";
    case STATS:            return "idle";
    case CHECKING_IN:      return "checking_in";
    case CHECKED_IN:       return "checked_in";
    case AWAITING_LID:     return "awaiting_lid";
    case ACTIVE:           return "active";
    case SHOWING_TIME:     return "active";
    case CHECKOUT_ARMING:  return "active";
    case CHECKOUT_CONFIRM: return "active";
    case RESPITE:          return "respite";
    case ENDED:            return "idle";
  }
  return "idle";
}

unsigned long phaseStartMs = 0;
unsigned long lastTickMs   = 0;

void setPhase(Phase p) {
  phase = p;
  phaseStartMs = millis();
  lastTickMs = 0;
}

uint32_t      activeSeq        = 0;
unsigned long sessionSegmentMs = 0;
unsigned long sessionAccumMs   = 0;
unsigned long lastCheckpointMs = 0;
unsigned long respiteStartMs   = 0;
uint32_t      endedDurationMs  = 0;
bool          endedWasRecord   = false;

// Faser där klockan tickar. CHECKED_IN är startceremonin — klockan
// går redan under den, annars skulle de första nio sekunderna tappas.
bool sessionRunning() {
  return phase == ACTIVE || phase == SHOWING_TIME || phase == CHECKED_IN;
}

bool sessionExists() {
  return sessionRunning() || phase == RESPITE;
}

unsigned long elapsedMs() {
  if (sessionRunning()) return sessionAccumMs + (millis() - sessionSegmentMs);
  return sessionAccumMs;
}

float checkinProgress  = 0.0;
float hintAlpha        = 1.0;   // synligheten på HOLD TO START
bool  requireRelease   = false;

// TouchPad-structen ligger i pausepod_types.h och kan inte utökas,
// så släpptidpunkterna bor här bredvid.
unsigned long padLReleasedMs = 0;
unsigned long padRReleasedMs = 0;

TouchPad padL = { TOUCH_LEFT_PIN,  false, false, 0, 0, "left" };
TouchPad padR = { TOUCH_RIGHT_PIN, false, false, 0, 0, "right" };

bool lidClosed  = false;
bool lastLidRaw = false;
unsigned long lastLidChangeMs = 0;

int statsPage = 0;
const int STATS_PAGES = 4;

// ─── Display ────────────────────────────────────────────────

TFT_eSPI tft = TFT_eSPI();
TFT_eSprite sprite = TFT_eSprite(&tft);
bool spriteOK = false;

uint16_t BLUE, BLUE_GLOW, BLUE_DIM, GREEN, BG;

const int SCREEN_W = 320;
const int SCREEN_H = 170;
const int CENTER_X = 160;
const int CENTER_Y = 85;
const int ICON_SIZE_LOGO = 14;
const int ICON_SIZE_PAUSE_LARGE = 50;
const int RING_R = 46;
const int THUMB_R = 66;   // prickarna utanför ringen, inte på den
const unsigned long BREATH_CYCLE_MS = 8000;

unsigned long lastFrame = 0;
const unsigned long FRAME_INTERVAL_MS = 33;

// Grundtonen i märkesblått, skalad i ljusstyrka.
// Det här ersätter (p > 0.5) ? BLUE : BLUE_DIM, som gav ett hopp
// mellan två färger var fjärde sekund istället för en andning.
uint16_t blueAt(float k) {
  if (k < 0.0) k = 0.0;
  if (k > 1.0) k = 1.0;
  return tft.color565((uint8_t)(46 * k + 0.5),
                      (uint8_t)(134 * k + 0.5),
                      (uint8_t)(222 * k + 0.5));
}

uint16_t greenAt(float k) {
  if (k < 0.0) k = 0.0;
  if (k > 1.0) k = 1.0;
  return tft.color565((uint8_t)(60 * k + 0.5),
                      (uint8_t)(200 * k + 0.5),
                      (uint8_t)(120 * k + 0.5));
}

void drawPauseIcon(int cx, int cy, int size, uint16_t color) {
  int barW = max(3, size / 4);
  int barH = size;
  int gap  = barW + 2;
  int leftX = cx - gap / 2 - barW;
  int topY  = cy - barH / 2;
  sprite.fillRoundRect(leftX, topY, barW, barH, 2, color);
  sprite.fillRoundRect(leftX + barW + gap, topY, barW, barH, 2, color);
}

// Steglängden räknas från radien så punkterna hamnar ~2 px isär.
// Fast 1,5° gav 240 fillCircle-anrop per ring oavsett storlek.
void drawArc(int cx, int cy, int r, int thickness, float startDeg, float endDeg, uint16_t color) {
  if (endDeg <= startDeg || r <= 0) return;
  float step = 360.0 / (PI * r);        // ≈ 2 px mellan punkter
  if (step < 1.0) step = 1.0;
  for (float a = startDeg; a <= endDeg; a += step) {
    float rad = a * DEG_TO_RAD;
    sprite.fillCircle(cx + cos(rad) * r, cy + sin(rad) * r, thickness / 2, color);
  }
}

// Bakgrundsringen ritas bara där framsidan inte täcker den
void drawProgressRing(int cx, int cy, int r, int thickness, float progress, uint16_t fg) {
  float end = -90.0 + 360.0 * progress;
  if (progress < 0.999) drawArc(cx, cy, r, thickness, end, 270, BLUE_DIM);
  if (progress > 0.005) drawArc(cx, cy, r, thickness, -90, end, fg);
}

// Tummarkören. Vilande är den en tom ring som visar var tummen hör
// hemma — synlig innan man rört något, vilket är halva instruktionen.
// Vid anslag sveper en våg ut och pricken fylls och får sken.
void drawThumbMark(int cx, int cy, bool on, unsigned long since) {
  if (on) {
    float t = since / (float)THUMB_PULSE_MS;
    if (t > 1.0) t = 1.0;
    float e = 1.0 - (1.0 - t) * (1.0 - t);      // ease-out

    if (t < 1.0) {                               // vågen, tonar bort
      float fade = 1.0 - t;
      int r = 6 + (int)(18 * e);
      sprite.drawCircle(cx, cy, r,     blueAt(0.60 * fade));
      sprite.drawCircle(cx, cy, r - 1, blueAt(0.30 * fade));
    }

    int r = 4 + (int)(3 * e);
    sprite.fillCircle(cx, cy, r + 3, blueAt(0.20));            // sken
    sprite.fillCircle(cx, cy, r,     blueAt(0.60 + 0.40 * e)); // pricken
  } else {
    float t = since / (float)THUMB_RELEASE_MS;
    if (t > 1.0) t = 1.0;
    sprite.drawCircle(cx, cy, 7 - (int)(2 * t), blueAt(0.45 - 0.15 * t));
  }
}

void drawThumbMarks(int r) {
  unsigned long now = millis();
  drawThumbMark(CENTER_X - r, CENTER_Y, padL.state,
                now - (padL.state ? padL.pressedAtMs : padLReleasedMs));
  drawThumbMark(CENTER_X + r, CENTER_Y, padR.state,
                now - (padR.state ? padR.pressedAtMs : padRReleasedMs));
}

// Tjock linje med runda ändar — samma teknik som ringarna
void drawThickLine(int x0, int y0, int x1, int y1, int thickness, uint16_t color) {
  float dx = x1 - x0, dy = y1 - y0;
  float len = sqrt(dx * dx + dy * dy);
  if (len < 1) { sprite.fillCircle(x0, y0, thickness / 2, color); return; }
  int steps = (int)len;
  for (int i = 0; i <= steps; i++) {
    float t = i / (float)steps;
    sprite.fillCircle(x0 + dx * t, y0 + dy * t, thickness / 2, color);
  }
}

// Bocken. size = ungefär bockens bredd.
// progress 0-1 ritar den i två drag: korta benet först, sedan det långa.
void drawCheck(int cx, int cy, int size, int thickness, float progress, uint16_t color) {
  if (progress <= 0.0) return;
  if (progress > 1.0) progress = 1.0;

  // Proportioner: kort ben ned-höger, långt ben upp-höger
  float ax = cx - size * 0.42, ay = cy + size * 0.05;
  float bx = cx - size * 0.10, by = cy + size * 0.34;
  float ex = cx + size * 0.45, ey = cy - size * 0.32;

  const float SHORT_PART = 0.35;   // andel av animationen som korta benet tar

  if (progress <= SHORT_PART) {
    float t = progress / SHORT_PART;
    drawThickLine(ax, ay, ax + (bx - ax) * t, ay + (by - ay) * t, thickness, color);
  } else {
    float t = (progress - SHORT_PART) / (1.0 - SHORT_PART);
    drawThickLine(ax, ay, bx, by, thickness, color);
    drawThickLine(bx, by, bx + (ex - bx) * t, by + (ey - by) * t, thickness, color);
  }
}

float breathProgress(unsigned long elapsed) {
  elapsed = elapsed % BREATH_CYCLE_MS;
  if (elapsed < BREATH_CYCLE_MS / 2) {
    float t = elapsed / (float)(BREATH_CYCLE_MS / 2);
    return 0.5 - 0.5 * cos(t * PI);
  }
  float t = (elapsed - BREATH_CYCLE_MS / 2) / (float)(BREATH_CYCLE_MS / 2);
  return 1.0 - (0.5 - 0.5 * cos(t * PI));
}

String formatDuration(uint64_t ms) {
  uint32_t totalSec = ms / 1000;
  uint32_t h = totalSec / 3600;
  uint32_t m = (totalSec % 3600) / 60;
  uint32_t s = totalSec % 60;
  char buf[16];
  if (h > 0) sprintf(buf, "%lu:%02lu:%02lu", (unsigned long)h, (unsigned long)m, (unsigned long)s);
  else       sprintf(buf, "%02lu:%02lu", (unsigned long)m, (unsigned long)s);
  return String(buf);
}

String formatHoursShort(uint64_t ms) {
  uint32_t totalMin = ms / 60000;
  uint32_t h = totalMin / 60;
  uint32_t m = totalMin % 60;
  char buf[16];
  if (h > 0) sprintf(buf, "%luh %lum", (unsigned long)h, (unsigned long)m);
  else       sprintf(buf, "%lum", (unsigned long)m);
  return String(buf);
}

int batteryPercent() {
  int raw = analogRead(BATTERY_ADC_PIN);
  float v = (raw / 4095.0) * 2.0 * 3.3;
  int pct = (int)(((v - 3.30) / (4.20 - 3.30)) * 100.0);
  return constrain(pct, 0, 100);
}

// ─── Renderare ──────────────────────────────────────────────

void renderIdle() {
  sprite.fillSprite(BG);
  uint16_t c = blueAt(0.30 + 0.70 * breathProgress(millis() - phaseStartMs));

  sprite.setTextDatum(ML_DATUM);
  sprite.setTextColor(c, BG);
  sprite.setFreeFont(&FreeSans9pt7b);

  String text = "P A U S E   P O D";
  int textW = sprite.textWidth(text);
  int iconBoxW = ICON_SIZE_LOGO + 6;
  int gap = 12;
  int startX = (SCREEN_W - (iconBoxW + gap + textW)) / 2;

  drawPauseIcon(startX + iconBoxW / 2, CENTER_Y, ICON_SIZE_LOGO, c);
  sprite.drawString(text, startX + iconBoxW + gap, CENTER_Y);
  sprite.pushSprite(0, 0);
}

// Inbjudan: tom ring, två vilande tummarkörer och en instruktion som
// tonar bort i samma stund som första tummen landar.
void renderCheckin() {
  sprite.fillSprite(BG);
  drawProgressRing(CENTER_X, CENTER_Y, RING_R, 6, checkinProgress, BLUE);
  drawThumbMarks(THUMB_R);
  drawPauseIcon(CENTER_X, CENTER_Y, 26, BLUE_GLOW);

  if (hintAlpha > 0.01) {
    sprite.setTextDatum(MC_DATUM);
    sprite.setTextColor(blueAt(0.55 * hintAlpha), BG);
    sprite.setFreeFont(&FreeSans9pt7b);
    sprite.drawString("HOLD TO START", CENTER_X, CENTER_Y + RING_R + 20);
  }

  sprite.pushSprite(0, 0);
}

// Startceremonin, i ett svep:
//   bock → PAUSE STARTED → 1 2 3 4 5 → uttoning → pausikonen tonas in.
// Klockan går redan; siffrorna är rituella, inte klockan.
void renderCheckedIn() {
  sprite.fillSprite(BG);
  unsigned long t = millis() - phaseStartMs;
  sprite.setTextDatum(MC_DATUM);

  if (t < CER_CHECK_END) {
    float draw = t / (float)CHECK_DRAW_MS;
    float fade = 1.0;
    unsigned long left = CER_CHECK_END - t;
    if (left < CHECK_FADE_MS) fade = left / (float)CHECK_FADE_MS;
    drawArc(CENTER_X, CENTER_Y, RING_R, 6, -90, 270, greenAt(fade));
    drawCheck(CENTER_X, CENTER_Y, RING_R, 8, draw, greenAt(fade));

  } else if (t < CER_TEXT_END) {
    float u = (t - CER_CHECK_END) / (float)STARTED_TEXT_MS;
    float k = (u < 0.2) ? u / 0.2 : ((u > 0.8) ? (1.0 - u) / 0.2 : 1.0);
    sprite.setTextColor(blueAt(k), BG);
    sprite.setFreeFont(&FreeSansBold12pt7b);
    sprite.drawString("PAUSE STARTED", CENTER_X, CENTER_Y);

  } else if (t < CER_COUNT_END) {
    unsigned long ct = t - CER_TEXT_END;
    int n = ct / 1000 + 1;
    if (n > COUNT_SECONDS) n = COUNT_SECONDS;
    float within = (ct % 1000) / 1000.0;
    float k = (within < 0.15) ? within / 0.15 : 1.0;
    sprite.setTextColor(blueAt(k), BG);
    sprite.setFreeFont(&FreeSansBold18pt7b);
    sprite.drawString(formatDuration(n * 1000UL), CENTER_X, CENTER_Y);

  } else if (t < CER_FADE_END) {
    float k = 1.0 - (t - CER_COUNT_END) / (float)COUNT_FADE_MS;
    sprite.setTextColor(blueAt(k), BG);
    sprite.setFreeFont(&FreeSansBold18pt7b);
    sprite.drawString(formatDuration(COUNT_SECONDS * 1000UL), CENTER_X, CENTER_Y);

  } else {
    // Samma bild som renderActive, tonad från svart så övergången inte syns
    float k = (t - CER_FADE_END) / (float)LOGO_FADE_MS;
    if (k > 1.0) k = 1.0;
    for (int i = 8; i >= 1; i--) {
      uint8_t intensity = (uint8_t)((30 - (i * 3)) * k);
      uint16_t glow = tft.color565(intensity / 3, intensity, intensity * 1.5);
      sprite.drawCircle(CENTER_X, CENTER_Y, 30 + i, glow);
    }
    drawPauseIcon(CENTER_X, CENTER_Y, ICON_SIZE_PAUSE_LARGE, blueAt(k));
  }

  sprite.pushSprite(0, 0);
}

// Två instruktioner i samma fas: lägg ner telefonen, sedan stäng locket.
// Bytet sker när appens accelerometer säger ifrån.
void renderAwaitingLid() {
  sprite.fillSprite(BG);
  uint16_t c = blueAt(0.55 + 0.45 * breathProgress(millis() - phaseStartMs));
  sprite.setTextDatum(MC_DATUM);
  sprite.setTextColor(c, BG);
  sprite.setFreeFont(&FreeSansBold12pt7b);

  if (phonePlaced) {
    sprite.drawString("CLOSE BOX", CENTER_X, CENTER_Y);
  } else {
    sprite.drawString("PLACE PHONE", CENTER_X, CENTER_Y - 13);
    sprite.drawString("IN BOX",      CENTER_X, CENTER_Y + 13);
  }

  sprite.pushSprite(0, 0);
}

void renderActive() {
  sprite.fillSprite(BG);
  for (int i = 8; i >= 1; i--) {
    uint8_t intensity = 30 - (i * 3);
    uint16_t glow = tft.color565(intensity / 3, intensity, intensity * 1.5);
    sprite.drawCircle(CENTER_X, CENTER_Y, 30 + i, glow);
  }
  drawPauseIcon(CENTER_X, CENTER_Y, ICON_SIZE_PAUSE_LARGE, BLUE);
  sprite.pushSprite(0, 0);
}

void renderShowingTime() {
  sprite.fillSprite(BG);
  drawThumbMarks(THUMB_R);
  sprite.setTextDatum(MC_DATUM);
  sprite.setTextColor(BLUE, BG);
  sprite.setFreeFont(&FreeSansBold18pt7b);
  sprite.drawString(formatDuration(elapsedMs()), CENTER_X, CENTER_Y);
  sprite.pushSprite(0, 0);
}

// Locket öppnat. Klockan står still och siffrorna med den — orörligheten
// är budskapet. Ringen runt krymper och visar hur länge pausen hålls kvar.
void renderRespite() {
  sprite.fillSprite(BG);
  const int R = 46;

  unsigned long since = millis() - respiteStartMs;
  unsigned long left  = (since >= RESPITE_MS) ? 0 : (RESPITE_MS - since);
  float frac = left / (float)RESPITE_MS;

  // Framsidan måste vara ljusare än BLUE_DIM, annars syns ingen rörelse
  drawProgressRing(CENTER_X, CENTER_Y, R, 5, frac, blueAt(0.65));

  sprite.setTextDatum(MC_DATUM);
  sprite.setTextColor(blueAt(0.45), BG);
  sprite.setFreeFont(&FreeSansBold18pt7b);
  sprite.drawString(formatDuration(elapsedMs()), CENTER_X, CENTER_Y - 6);

  sprite.setTextColor(blueAt(0.30), BG);
  sprite.setFreeFont(&FreeSans9pt7b);
  sprite.drawString("ON HOLD", CENTER_X, CENTER_Y + 24);

  sprite.pushSprite(0, 0);
}

void renderEnded() {
  sprite.fillSprite(BG);
  for (int i = 8; i >= 1; i--) {
    uint8_t intensity = 30 - (i * 3);
    uint16_t glow = tft.color565(intensity / 3, intensity, intensity * 1.5);
    sprite.drawCircle(CENTER_X, CENTER_Y, 48 + i, glow);
  }
  sprite.setTextDatum(MC_DATUM);
  sprite.setTextColor(BLUE_GLOW, BG);
  sprite.setFreeFont(&FreeSans9pt7b);
  sprite.drawString("PAUSE DONE", CENTER_X, CENTER_Y - 30);

  sprite.setTextColor(BLUE, BG);
  sprite.setFreeFont(&FreeSansBold18pt7b);
  sprite.drawString(formatDuration(endedDurationMs), CENTER_X, CENTER_Y + 4);

  if (endedWasRecord) {
    sprite.setTextColor(BLUE_GLOW, BG);
    sprite.setFreeFont(&FreeSans9pt7b);
    sprite.drawString("LONGEST YET", CENTER_X, CENTER_Y + 42);
  }
  sprite.pushSprite(0, 0);
}

void renderStats() {
  sprite.fillSprite(BG);
  String label, value;
  switch (statsPage) {
    case 0: label = "L O N G E S T"; value = formatDuration(statLongestMs);  break;
    case 1: label = "L A S T";       value = formatDuration(statLatestMs);   break;
    case 2: label = "T O T A L";     value = formatHoursShort(statTotalMs);  break;
    case 3: label = "B A T T E R Y"; value = String(batteryPercent()) + "%"; break;
    default: statsPage = 0; return;
  }

  sprite.setTextDatum(MC_DATUM);
  sprite.setTextColor(BLUE_GLOW, BG);
  sprite.setFreeFont(&FreeSans9pt7b);
  sprite.drawString(label, CENTER_X, CENTER_Y - 34);

  sprite.setTextColor(BLUE, BG);
  sprite.setFreeFont(&FreeSansBold18pt7b);
  sprite.drawString(value, CENTER_X, CENTER_Y + 6);

  int dotGap = 16;
  int startX = CENTER_X - ((STATS_PAGES - 1) * dotGap) / 2;
  for (int i = 0; i < STATS_PAGES; i++) {
    sprite.fillCircle(startX + i * dotGap, CENTER_Y + 52, 3, i == statsPage ? BLUE : BLUE_DIM);
  }
  sprite.pushSprite(0, 0);
}

// ─── Sessionslogik ──────────────────────────────────────────

// Startar klockan och loggar sessionen. Sätter INTE fasen — anroparen
// väljer om det ska bli ceremoni (CHECKED_IN) eller rakt på (ACTIVE).
void startSession() {
  activeSeq = nextSeq++;
  prefs.putUInt("next_seq", nextSeq);
  sessionAccumMs   = 0;
  sessionSegmentMs = millis();
  lastCheckpointMs = millis();
  checkinProgress  = 0;
  playStartTone();
  sendBLE("session_started:%lu", (unsigned long)activeSeq);
  Serial.printf("Session %lu startad\n", (unsigned long)activeSeq);
}

void endSession(bool completed) {
  unsigned long dur = elapsedMs();
  sessionAccumMs  = dur;
  requireRelease  = true;

  if (dur < MIN_SESSION_MS) {
    Serial.println("Session för kort, kastas");
    prefs.remove("cp_seq");
    activeSeq = 0;
    setPhase(IDLE);
    return;
  }

  endedWasRecord = (dur > statLongestMs);

  SessionRecord r;
  r.seq           = activeSeq;
  r.durationMs    = dur;
  r.endedAtMillis = millis();
  r.completed     = completed ? 1 : 0;
  queuePush(r);

  statTotalMs += dur;
  statLatestMs = dur;
  if (endedWasRecord) statLongestMs = dur;
  statCount++;
  saveStats();
  prefs.remove("cp_seq");

  endedDurationMs = dur;
  activeSeq = 0;
  setPhase(ENDED);
  playEndTone();
  sendBLE("session_ended:%lu:%lu:%d:0",
          (unsigned long)r.seq, (unsigned long)r.durationMs, r.completed);
}

void checkpoint() {
  prefs.putUInt("cp_seq", activeSeq);
  prefs.putUInt("cp_ms", elapsedMs());
  lastCheckpointMs = millis();
}

void recoverCheckpoint() {
  uint32_t cpSeq = prefs.getUInt("cp_seq", 0);
  if (cpSeq == 0) return;
  uint32_t cpMs = prefs.getUInt("cp_ms", 0);
  Serial.printf("Återställer avbruten session %lu\n", (unsigned long)cpSeq);
  if (cpMs >= MIN_SESSION_MS) {
    SessionRecord r;
    r.seq = cpSeq; r.durationMs = cpMs; r.endedAtMillis = 0; r.completed = 0;
    queuePush(r);
    statTotalMs += cpMs;
    statLatestMs = cpMs;
    if (cpMs > statLongestMs) statLongestMs = cpMs;
    statCount++;
    saveStats();
  }
  prefs.remove("cp_seq");
}

// ─── Backlog ────────────────────────────────────────────────

void sendNextBacklog() {
  if (!deviceConnected || queueCount == 0) { backlogSending = false; return; }
  SessionRecord& r = queueBuf[0];
  backlogSending  = true;
  backlogAwaitSeq = r.seq;
  backlogSentAt   = millis();
  unsigned long ago = r.endedAtMillis > 0 ? (millis() - r.endedAtMillis) : 0;
  sendBLE("session_ended:%lu:%lu:%d:%lu",
          (unsigned long)r.seq, (unsigned long)r.durationMs, r.completed, ago);
}

// ─── BLE-callbacks ──────────────────────────────────────────

class CharCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) {
    // Kritisk sektion runt själva läsningen — se bleValueMux ovan. Kopiera
    // ut hela värdet till en lokal String innan låset släpps; gör inget
    // annat (trim, jämförelser) medan låset hålls.
    portENTER_CRITICAL(&bleValueMux);
    String msg = c->getValue().c_str();
    portEXIT_CRITICAL(&bleValueMux);

    int rawLen = msg.length();
    msg.trim();
    Serial.printf("← \"%s\" (%d tecken mottagna, %d efter trim)\n", msg.c_str(), rawLen, msg.length());

    // Bara flaggsättning här. All NVS och alla notifies sker i loop().
    if (msg.startsWith("session_ack:")) {
      pendingAckSeq = msg.substring(12).toInt();
      return;
    }
    if (msg.startsWith("phone_down")) {
      pendingPhoneDown = true;
      return;
    }
    if (msg.startsWith("phone_up")) {
      pendingPhoneUp = true;
      return;
    }
    if (msg.startsWith("set_mode:")) {
      // Lådan behöver inget läge för sin drift, men meddelandet talar om
      // att en paus valts i appen → be om telefonen.
      pendingSetMode = true;
      return;
    }
    // time_sync tas emot men ignoreras medvetet.
  }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) {
    deviceConnected = true;
    Serial.println("App ansluten");
  }
  void onDisconnect(BLEServer* s) {
    deviceConnected = false;
    backlogSending = false;
    backlogStartAt = 0;
    handshakeAt = 0;
    Serial.println("App frånkopplad");
    BLEDevice::startAdvertising();
  }
};

void onConnectedHandshake() {
  // notify() har bara en notis i flykten åt gången per karaktäristik — ropar
  // man den igen innan stacken hunnit sända den föregående över luften
  // tappas den tyst (inget kö, inget felvärde att kolla). Utan mellanrum
  // här kunde appen missa state eller battery på nästan varje anslutning.
  sendBLE("hello:%s", boxId.c_str());
  delay(20);
  sendBLE("state:%s:%lu:%lu", phaseName(phase),
          (unsigned long)elapsedMs(), (unsigned long)activeSeq);
  delay(20);
  sendBLE("battery:%d", batteryPercent());
  lastBatteryReport = millis();
  backlogStartAt = millis() + BACKLOG_START_MS;   // kön skickas strax efter
}

// ─── Touch och lock ─────────────────────────────────────────

void enterStats(int delta) {
  if (phase != STATS) {
    statsPage = 0;
  } else {
    statsPage += delta;
    if (statsPage < 0) statsPage = STATS_PAGES - 1;
    if (statsPage >= STATS_PAGES) statsPage = 0;
  }
  setPhase(STATS);
}

void handlePad(TouchPad& pad, int navDelta) {
  bool raw = digitalRead(pad.pin) == HIGH;
  unsigned long now = millis();

  if (raw != pad.lastRaw) { pad.lastChangeMs = now; pad.lastRaw = raw; }
  if (now - pad.lastChangeMs < DEBOUNCE_MS) return;
  if (raw == pad.state) return;

  pad.state = raw;

  if (raw) {
    pad.pressedAtMs = now;
    sendBLE("touch_begin:%s", pad.name);
  } else {
    sendBLE("touch_end:%s", pad.name);
    if (&pad == &padL) padLReleasedMs = now; else padRReleasedMs = now;
    if (!padL.state && !padR.state) requireRelease = false;
    unsigned long held = now - pad.pressedAtMs;
    if (held < TAP_MAX_MS && (phase == IDLE || phase == STATS || phase == ENDED)) {
      enterStats(navDelta);
    }
  }
}

float tickDelta() {
  unsigned long now = millis();
  if (lastTickMs == 0) { lastTickMs = now; return 0; }
  float dt = now - lastTickMs;
  lastTickMs = now;
  if (dt > 200) dt = 200;
  return dt;
}

// Incheckningen sker numera med locket redan stängt. CHECKING_IN är
// därför ett viloläge med en tom ring, inte ett förlopp som avbryts.
void updateCheckin() {
  if (phase != CHECKING_IN) return;

  bool both = padL.state && padR.state;
  bool any  = padL.state || padR.state;
  float dt  = tickDelta();

  // Tummarna låg kvar från något annat — vänta tills de lyfts
  if (requireRelease) { checkinProgress = 0; return; }

  // Instruktionen tonar bort så fort en tumme landar, och tillbaka
  // om plattorna släpps utan att något hänt
  if (any || checkinProgress > 0.0) hintAlpha -= dt / (float)HINT_FADE_OUT_MS;
  else                              hintAlpha += dt / (float)HINT_FADE_IN_MS;
  if (hintAlpha < 0.0) hintAlpha = 0.0;
  if (hintAlpha > 1.0) hintAlpha = 1.0;

  if (both) checkinProgress += dt / (float)CHECKIN_FILL_MS;
  else      checkinProgress -= (dt / (float)CHECKIN_FILL_MS) * RING_BACKOFF;

  if (checkinProgress >= 1.0) {
    checkinProgress = 1.0;
    playCheckinTone();
    sendBLE("checkin_complete");
    // Utan denna hann startSession()s egen sendBLE("session_started:…")
    // nästan alltid tappas — notify() tappar tyst en notis som kommer
    // innan den föregående hunnit ut över luften (se onConnectedHandshake).
    // 20 ms är omärkbart mot "samma ögonblick som bocken sluts".
    delay(20);
    startSession();          // klockan börjar i samma ögonblick som bocken sluts
    requireRelease = true;   // tummarna måste lyftas innan utcheckning kan börja
    setPhase(CHECKED_IN);    // startceremonin
    return;
  }

  if (checkinProgress <= 0.0) {
    checkinProgress = 0.0;
    // Locket öppet igen och ingen rör plattorna → tillbaka till CLOSE BOX.
    // I praktiken hinner handleLid() hit först (den sätter AWAITING_LID i
    // samma ögonblick som lidClosed blir false, och då returnerar den här
    // funktionen direkt på fas-kollen ovan) — raden står kvar som samma
    // svar på samma fråga, så att de två aldrig kan hamna i otakt.
    if (!any && !lidClosed) { hintAlpha = 1.0; phonePlaced = true; setPhase(AWAITING_LID); }
  }
}

// Under pausen betyder tummarna en enda sak: visa hur länge det gått.
// Utcheckning med tummarna finns inte längre — locket är vägen ut, och
// då är gesten fri att bara betyda "börja" när den används i ringen.
void updateCheckout() {
  if (!sessionExists()) return;
  if (requireRelease) return;

  bool any = padL.state || padR.state;

  if (phase == ACTIVE && any) {
    setPhase(SHOWING_TIME);
  } else if (phase == SHOWING_TIME && !any) {
    setPhase(ACTIVE);
  }
}

void handleLid() {
  bool raw = digitalRead(HALL_PIN) == LOW;
  unsigned long now = millis();

  if (raw != lastLidRaw) { lastLidChangeMs = now; lastLidRaw = raw; }
  if (now - lastLidChangeMs < DEBOUNCE_MS) return;
  if (raw == lidClosed) return;

  lidClosed = raw;

  if (lidClosed) {
    sendBLE("lid_closed");
    if (phase == RESPITE) {
      sessionSegmentMs = millis();
      setPhase(ACTIVE);
    } else if (phase == AWAITING_LID) {
      // Bara en paus som appen har bett om kan checkas in. AWAITING_LID nås
      // enbart via set_mode/phone_down från appen, så ett lock som stängs
      // medan lådan står på loggan gör ingenting alls — lådan startar aldrig
      // en paus på egen hand. Checkar ingen in faller den tillbaka till
      // loggan efter CHECKIN_TIMEOUT_MS utan att någon paus räknats.
      checkinProgress = 0;
      hintAlpha = 1.0;
      setPhase(CHECKING_IN);
    }
  } else {
    sendBLE("lid_opened");
    if (sessionRunning()) {
      sessionAccumMs += millis() - sessionSegmentMs;
      respiteStartMs = millis();
      setPhase(RESPITE);
    } else if (phase == CHECKING_IN) {
      // Locket öppnat innan incheckningen — ingen session hann börja, men
      // försöket är inte förbrukat: tillbaka till CLOSE BOX i stället för
      // loggan, så att locket bara kan stängas igen. Att titta i lådan är
      // inte samma sak som att ångra sig, och den som gjorde det stod förr
      // med en låda på loggan och en app som sa PAUSE NOT STARTED.
      //
      // phonePlaced sätts true oavsett vad den var: locket HAR varit stängt,
      // alltså ligger telefonen i lådan, och renderAwaitingLid ska visa
      // CLOSE BOX och inte PLACE PHONE IN BOX. setPhase startar samtidigt om
      // AWAIT_LID_MAX_MS, så de 90 sekunderna räknas från det här ögonblicket.
      checkinProgress = 0;
      hintAlpha = 1.0;
      phonePlaced = true;
      setPhase(AWAITING_LID);
    }
  }
}

// ─── Setup / Loop ───────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  pinMode(POWER_PIN, OUTPUT);
  digitalWrite(POWER_PIN, HIGH);
  pinMode(TOUCH_LEFT_PIN, INPUT_PULLDOWN);
  pinMode(TOUCH_RIGHT_PIN, INPUT_PULLDOWN);
  pinMode(HALL_PIN, INPUT_PULLUP);

  tft.init();
  tft.setRotation(1);
  BLUE      = tft.color565(46, 134, 222);
  BLUE_GLOW = tft.color565(80, 160, 230);
  BLUE_DIM  = tft.color565(20, 60, 110);
  GREEN     = tft.color565(60, 200, 120);   // enda bekräftelsefärgen i produkten
  BG        = TFT_BLACK;

  tft.fillScreen(BG);

  // 320x170 i 16 bitar = 108 kB. Allokeras före BLE, som tar sitt
  // eget minne. Misslyckas den blir skärmen svart och stilla —
  // därför loggas det istället för att gå tyst.
  sprite.setColorDepth(16);
  spriteOK = (sprite.createSprite(SCREEN_W, SCREEN_H) != nullptr);
  if (!spriteOK) {
    Serial.println("KRITISKT: sprite kunde inte allokeras");
    tft.setTextColor(TFT_RED, BG);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("SPRITE ALLOC FAILED", CENTER_X, CENTER_Y, 2);
  }
  Serial.printf("Heap efter sprite: %u byte fri\n", ESP.getFreeHeap());

  loadPersisted();
  recoverCheckpoint();

  BLEDevice::init("PausePod");
  BLEServer* pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_WRITE
  );
  pCharacteristic->setCallbacks(new CharCallbacks());
  pCharacteristic->addDescriptor(new BLE2902());
  pService->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->start();

  lidClosed  = digitalRead(HALL_PIN) == LOW;
  lastLidRaw = lidClosed;
  setPhase(IDLE);

  Serial.printf("Pause Pod redo. box_id=%s seq=%lu heap=%u\n",
                boxId.c_str(), (unsigned long)nextSeq, ESP.getFreeHeap());
}

void loop() {
  handlePad(padL, -1);
  handlePad(padR, +1);
  updateCheckin();
  updateCheckout();
  handleLid();

  unsigned long now = millis();

  // Ack från appen — NVS-skrivningen görs här, inte i callbacken
  if (pendingAckSeq != 0) {
    uint32_t seq = pendingAckSeq;
    pendingAckSeq = 0;
    queueRemoveSeq(seq);
    if (backlogSending && seq == backlogAwaitSeq) {
      backlogSending = false;
      sendNextBacklog();
    }
  }

  // Paus vald i appen → be om telefonen
  if (pendingSetMode) {
    pendingSetMode = false;
    if (phase == IDLE || phase == STATS) {
      phonePlaced = false;
      setPhase(AWAITING_LID);
    }
  }

  // Telefonen nedlagd enligt appen → be om locket
  if (pendingPhoneDown) {
    pendingPhoneDown = false;
    if (phase == IDLE || phase == STATS ||
        (phase == AWAITING_LID && !phonePlaced)) {
      phonePlaced = true;
      setPhase(AWAITING_LID);
    }
  }

  // Telefonen är inte längre nedlagd, enligt appens accelerometer. Vad det
  // betyder avgörs av fasen — precis som för phone_down, som också bara är
  // en rapport om telefonens läge och inte en order:
  //
  //  RESPITE      → pausen är slut, completed=1. Gäller bara när locket redan
  //                 är öppet, annars skulle en flyttad låda kunna döda en
  //                 pågående paus.
  //  AWAITING_LID → telefonen togs upp igen innan locket hann stängas.
  //                 Tillbaka till PLACE PHONE IN BOX, så att displayen säger
  //                 samma sak som appen. Utan det här stod lådan kvar på
  //                 CLOSE BOX och bad om ett lock till en tom låda.
  if (pendingPhoneUp) {
    pendingPhoneUp = false;
    if (phase == RESPITE) {
      endSession(true);
    } else if (phase == AWAITING_LID && phonePlaced) {
      // setPhase startar om nedräkningen, och med phonePlaced = false gäller
      // återigen PHONE_WAIT_MAX_MS före AWAIT_LID_MAX_MS — samma fönster som
      // direkt efter set_mode, vilket är precis vad läget är: vi väntar på
      // telefonen igen. Appens ankare speglar det (se placeinbox.tsx).
      phonePlaced = false;
      setPhase(AWAITING_LID);
    }
  }

  // Appen tyst för länge — visa CLOSE BOX ändå hellre än att stå kvar
  if (phase == AWAITING_LID && !phonePlaced && now - phaseStartMs > PHONE_WAIT_MAX_MS) {
    phonePlaced = true;
    setPhase(AWAITING_LID);
  }

  // Ingen stänger locket — släpp instruktionen, gå tillbaka till loggan
  if (phase == AWAITING_LID && phonePlaced && now - phaseStartMs > AWAIT_LID_MAX_MS) {
    setPhase(IDLE);
  }

  // Ingen checkar in. Incheckningen är en grind, inte bara ceremoni: en paus
  // börjar aldrig av sig själv, för lådan kan inte veta om det ligger någon
  // telefon i den — ett stängt lock på en tom låda loggade annars en riktig
  // paus. Tillbaka till loggan så skärmen inte står tänd i all evighet; nytt
  // försök kräver att locket öppnas och stängs igen.
  if (phase == CHECKING_IN && !padL.state && !padR.state &&
      checkinProgress <= 0.0 && now - phaseStartMs > CHECKIN_TIMEOUT_MS) {
    setPhase(IDLE);
  }

  // Ceremonin klar → pausen tar över skärmen
  if (phase == CHECKED_IN && now - phaseStartMs > CER_END) {
    setPhase(ACTIVE);
  }

  if (phase == STATS && now - phaseStartMs > STATS_TIMEOUT_MS && !padL.state && !padR.state) {
    setPhase(IDLE);
  }

  if (phase == ENDED && now - phaseStartMs > ENDED_SHOW_MS) {
    setPhase(IDLE);
  }

  if (phase == RESPITE && now - respiteStartMs >= RESPITE_MS) {
    endSession(false);
  }

  if (sessionRunning() && now - lastCheckpointMs >= CHECKPOINT_MS) {
    checkpoint();
  }

  if (deviceConnected != lastDeviceConnected) {
    if (deviceConnected) {
      // Skickas INTE här — appen har ännu inte hunnit prenumerera på notiser
      // (service discovery + CCCD tar hundratals ms), och allt som skickas
      // dessförinnan kastas av stacken. Se HANDSHAKE_DELAY_MS.
      handshakeAt = now + HANDSHAKE_DELAY_MS;
    } else if (phase == AWAITING_LID && !phonePlaced) {
      // Appen försvann mitt i väntan — ingen kan längre svara
      phonePlaced = true;
      setPhase(AWAITING_LID);
    }
    lastDeviceConnected = deviceConnected;
  }

  if (handshakeAt != 0 && now >= handshakeAt) {
    handshakeAt = 0;
    onConnectedHandshake();
  }

  if (backlogStartAt != 0 && now >= backlogStartAt) {
    backlogStartAt = 0;
    if (!backlogSending) sendNextBacklog();
  }

  if (backlogSending && now - backlogSentAt > ACK_TIMEOUT_MS) {
    backlogSending = false;
    sendNextBacklog();
  }

  if (deviceConnected && now - lastBatteryReport > BATTERY_REPORT_MS) {
    sendBLE("battery:%d", batteryPercent());
    lastBatteryReport = now;
  }

  // Sjunker den här stadigt över timmar läcker något minne
  static unsigned long lastHeapLog = 0;
  if (now - lastHeapLog > HEAP_LOG_MS) {
    Serial.printf("heap=%u största block=%u fas=%s\n",
                  ESP.getFreeHeap(), ESP.getMaxAllocHeap(), phaseName(phase));
    lastHeapLog = now;
  }

  if (spriteOK && now - lastFrame >= FRAME_INTERVAL_MS) {
    switch (phase) {
      case IDLE:             renderIdle();            break;
      case STATS:            renderStats();           break;
      case CHECKING_IN:      renderCheckin();         break;
      case CHECKED_IN:       renderCheckedIn();       break;
      case AWAITING_LID:     renderAwaitingLid();     break;
      case ACTIVE:           renderActive();          break;
      case SHOWING_TIME:     renderShowingTime();     break;
      // Finns kvar i pausepod_types.h men kan inte nås längre
      case CHECKOUT_ARMING:
      case CHECKOUT_CONFIRM: renderActive();          break;
      case RESPITE:          renderRespite();         break;
      case ENDED:            renderEnded();           break;
    }
    lastFrame = now;
  }

  delay(1);   // lämna över till BLE-stacken, annars spinner loopen hett
}
