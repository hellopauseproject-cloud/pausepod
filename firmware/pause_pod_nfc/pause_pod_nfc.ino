// Pause Pod – NFC-flöde med riktig registrering via appen
// LilyGO T-Display S3 + RC522
//
// Bibliotek (Arduino Library Manager):
//   - MFRC522 (GithubCommunity)
//   - GFX Library for Arduino (moononournation)
//   - ArduinoJson (Benoit Blanchon), version 7
// QR-koden görs med ESP32:ans inbyggda qrcode.
//
// Fyll i secrets.h (WiFi + boxens nyckel) innan du laddar upp.

#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <MFRC522.h>
#include <Arduino_GFX_Library.h>
#include "qrcode.h"
#include "secrets.h"

#define BLACK 0x0000
#define WHITE 0xFFFF
#define GREY  0x8410

// ---------- Pinnar ----------
#define SS_PIN        10
#define RST_PIN       1
#define PIN_POWER_ON  15
#define PIN_LCD_BL    38

// ---------- Hårdvara ----------
MFRC522 rfid(SS_PIN, RST_PIN);

Arduino_DataBus *bus = new Arduino_ESP32PAR8Q(
  7 /* DC */, 6 /* CS */, 8 /* WR */, 9 /* RD */,
  39, 40, 41, 42, 45, 46, 47, 48 /* D0–D7 */);
Arduino_GFX *gfx = new Arduino_ST7789(
  bus, 5 /* RST */, 1 /* liggande */, true /* IPS */,
  170, 320, 35, 0, 35, 0);

// ---------- Läge ----------
enum State { EMPTY, CHECKING, UNKNOWN_TAG, KNOWN_TAG, OFFLINE };
State state = EMPTY;
String currentUid = "";
String currentCode = "";
int missCount = 0;
const int MISS_LIMIT = 3;              // missade läsningar i rad = telefonen är borta
unsigned long lastPoll = 0;
const unsigned long POLL_MS = 3000;    // hur ofta boxen frågar om QR-koden använts

// ---------- RFID ----------
bool readTag(String &uid) {
  byte atqa[2];
  byte size = sizeof(atqa);
  if (rfid.PICC_WakeupA(atqa, &size) != MFRC522::STATUS_OK) return false;
  if (!rfid.PICC_ReadCardSerial()) return false;

  uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    char hex[3];
    sprintf(hex, "%02X", rfid.uid.uidByte[i]);
    uid += hex;
  }
  rfid.PICC_HaltA();
  return true;
}

// ---------- Skärmar ----------
void showMessage(const String& big, const String& small) {
  gfx->fillScreen(BLACK);
  gfx->setTextColor(WHITE);
  gfx->setTextSize(3);
  gfx->setCursor(20, 50);
  gfx->println(big);
  gfx->setTextSize(2);
  gfx->setTextColor(GREY);
  gfx->setCursor(20, 100);
  gfx->println(small);
}

void showWelcome(String name) {
  if (name.length() > 12) name = name.substring(0, 12);
  showMessage("Hi, " + name, "Close lid to start");
}

void drawQr(esp_qrcode_handle_t qr) {
  const int modules = esp_qrcode_get_size(qr);
  const int scale = 140 / modules;
  const int size = modules * scale;
  const int x0 = 18;
  const int y0 = (170 - size) / 2;

  gfx->fillRect(x0 - 6, y0 - 6, size + 12, size + 12, WHITE);
  for (int y = 0; y < modules; y++) {
    for (int x = 0; x < modules; x++) {
      if (esp_qrcode_get_module(qr, x, y)) {
        gfx->fillRect(x0 + x * scale, y0 + y * scale, scale, scale, BLACK);
      }
    }
  }
}

void showQr(const String& url, const String& code) {
  gfx->fillScreen(BLACK);

  esp_qrcode_config_t cfg = ESP_QRCODE_CONFIG_DEFAULT();
  cfg.display_func = drawQr;
  cfg.max_qrcode_version = 10;
  cfg.qrcode_ecc_level = ESP_QRCODE_ECC_LOW;
  esp_qrcode_generate(&cfg, url.c_str());

  gfx->setTextColor(WHITE);
  gfx->setTextSize(2);
  gfx->setCursor(175, 30);  gfx->println("New tag!");
  gfx->setCursor(175, 60);  gfx->println("Scan with");
  gfx->setCursor(175, 80);  gfx->println("Pause Pod");
  gfx->setTextColor(GREY);
  gfx->setTextSize(1);
  gfx->setCursor(175, 115); gfx->println("or enter code:");
  gfx->setTextColor(WHITE);
  gfx->setTextSize(3);
  gfx->setCursor(175, 130); gfx->println(code);
}

// ---------- WiFi ----------
bool ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) delay(250);
  return WiFi.status() == WL_CONNECTED;
}

// ---------- Backend ----------
// Frågar Supabase om taggen. Fyller i status ("known"/"unknown"), username eller url+code.
bool askBackend(const String& uid, String& status, String& username, String& url, String& code) {
  if (!ensureWifi()) return false;

  WiFiClientSecure client;
  client.setInsecure();   // PROTOTYP: kollar inte serverns certifikat. Byt mot setCACert före lansering.

  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(client, String(SUPABASE_URL) + "/functions/v1/box-tag")) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-box-id", BOX_ID);
  http.addHeader("x-box-key", BOX_KEY);

  int httpCode = http.POST("{\"tag_uid\":\"" + uid + "\"}");
  String payload = http.getString();
  http.end();

  if (httpCode != 200) {
    Serial.printf("Backend svarade %d: %s\n", httpCode, payload.c_str());
    return false;
  }

  JsonDocument doc;
  if (deserializeJson(doc, payload)) return false;
  status   = doc["status"]   | "";
  username = doc["username"] | "";
  url      = doc["url"]      | "";
  code     = doc["code"]     | "";
  return status.length() > 0;
}

// Hanterar svaret och byter skärm. Returnerar false om det inte gick att nå servern.
bool checkTag(const String& uid) {
  String status, username, url, code;
  if (!askBackend(uid, status, username, url, code)) {
    state = OFFLINE;
    showMessage("No connection", "Retrying...");
    return false;
  }

  if (status == "known") {
    Serial.println("Känd tagg: " + uid + " (" + username + ")");
    state = KNOWN_TAG;
    showWelcome(username);
  } else if (status == "unknown" && code != currentCode) {
    Serial.println("Okänd tagg: " + uid + ", kod " + code + " -> " + url);
    state = UNKNOWN_TAG;
    currentCode = code;
    showQr(url, code);
  }
  return true;
}

// ---------- Setup ----------
void setup() {
  pinMode(PIN_POWER_ON, OUTPUT);
  digitalWrite(PIN_POWER_ON, HIGH);
  pinMode(PIN_LCD_BL, OUTPUT);
  digitalWrite(PIN_LCD_BL, HIGH);

  Serial.begin(115200);

  gfx->begin();
  showMessage("Pause Pod", "Connecting WiFi...");

  SPI.begin(12, 13, 11, SS_PIN);
  rfid.PCD_Init();
  rfid.PCD_DumpVersionToSerial();

  if (ensureWifi()) {
    Serial.println("WiFi OK: " + WiFi.localIP().toString());
  } else {
    Serial.println("Kunde inte ansluta till WiFi, försöker igen när en tagg läggs på");
  }

  showMessage("Pause Pod", "Place your phone");
}

// ---------- Loop ----------
void loop() {
  String uid;

  if (readTag(uid)) {
    missCount = 0;

    if (uid != currentUid) {
      // Ny telefon lagd i boxen
      currentUid = uid;
      currentCode = "";
      state = CHECKING;
      showMessage("Hello!", "Checking...");
      checkTag(uid);
      lastPoll = millis();
    } else if ((state == UNKNOWN_TAG || state == OFFLINE) && millis() - lastPoll > POLL_MS) {
      // Väntar på att någon ska skanna QR-koden (eller på nätet)
      checkTag(uid);
      lastPoll = millis();
    }
  } else if (currentUid != "") {
    missCount++;
    if (missCount >= MISS_LIMIT) {
      Serial.println("Telefonen togs bort");
      currentUid = "";
      currentCode = "";
      missCount = 0;
      state = EMPTY;
      showMessage("Pause Pod", "Place your phone");
    }
  }

  delay(100);
}
