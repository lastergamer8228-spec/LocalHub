/*
 * LocalHub TouchPad — ESP32 capacitive touch-switch remote (peak bina-root)
 * ---------------------------------------------------------------------------
 * Turns an ESP32 into a multi-touch physical remote for your LocalHub phone
 * server. Uses the ESP32's BUILT-IN capacitive touch pins, so you can use bare
 * wires / foil / copper pads as touch switches — no extra buttons or resistors.
 *
 * Each touch switch supports THREE gestures, each mapped to a LocalHub action:
 *   TAP      -> short touch & release
 *   HOLD     -> press and keep for >= HOLD_MS
 *   DOUBLE   -> two quick taps
 *
 * Example default layout (4 switches, wires/foil only):
 *   SW1 GPIO 4  (T0):  TAP=torch   HOLD=back        DBL=home
 *   SW2 GPIO 15 (T3):  TAP=vol+    HOLD=vol-        DBL=mute
 *   SW3 GPIO 13 (T4):  TAP=swipe↑  HOLD=swipe↓      DBL=scroll-up
 *   SW4 GPIO 12 (T5):  TAP=recents HOLD=restart     DBL=dump-screen
 *
 * Actions are sent over your local Wi-Fi using LocalHub's own REST API — no
 * cloud, everything offline on your LAN. Admin token is acquired at boot and
 * auto-re-issued on 401.
 *
 * REQUIRED LIBRARY: ArduinoJson (Benoit Blanchon). Everything else is built-in.
 * Tested on ESP32 DevKit / ESP32-WROOM / ESP32-WROVER.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ============================ CONFIG ============================
const char* WIFI_SSID = "YourWiFiSSID";
const char* WIFI_PASS = "YourWiFiPassword";

// Your phone's IP + LocalHub port
const char* LOCALHUB_HOST = "192.168.0.108";
const uint16_t LOCALHUB_PORT = 8080;

// LocalHub admin credentials (use the admin account)
const char* LH_USER = "admin";
const char* LH_PASS = "admin";

// ---- Touch switches ----
// Number of touch switches to scan.
#define SW_COUNT 4
// Capacitive touch GPIOs (ESP32 touch channels T0,T3,T4,T5).
// GPIO4(T0), GPIO15(T3), GPIO13(T4), GPIO12(T5)
const uint8_t SW_PINS[SW_COUNT] = { 4, 15, 13, 12 };

// ---- Gesture timings (ms) ----
#define HOLD_MS      900    // press-and-hold to trigger the HOLD action
#define DOUBLE_MS    280    // max gap between two taps to count as a double
#define SINGLE_MS    330    // delay before a lone tap fires (must be > DOUBLE_MS)
#define DEBOUNCE_MS   8     // touch de-glitch window

// ---- Touch sensitivity ----
// Active threshold = baseline(pin) - TOUCH_DELTA. Lower = more sensitive.
#define TOUCH_DELTA  28
#define CAL_SAMPLES   24    // samples used to auto-calibrate baseline at boot

// Optional status LED (set to -1 to disable). GPIO2 = built-in blue LED on many
// DevKit boards.
#define LED 2

// ================================================================

// ---- Action model ----
typedef struct {
  const char* type;   // action type (see dispatcher below)
  const char* param;  // optional argument ("", "up", "down", button label, level...)
} Action;

typedef struct {
  Action tap;
  Action hold;
  Action dbl;
} SwitchActions;

// Default action map (edit freely). Types the dispatcher understands:
//   torch volume_up volume_down mute normal vibrate rotate brightness
//   brightness_up brightness_down open screenshot click longclick focus scroll
//   swipe type back home recents dump restart log none
SwitchActions ACTIONS[SW_COUNT] = {
  // SW1
  { { "torch",    ""    }, { "back",     "" }, { "home",     "" } },
  // SW2
  { { "volume_up", ""   }, { "volume_down",""}, { "mute",     "" } },
  // SW3
  { { "swipe",    "up"  }, { "swipe",    "down" }, { "scroll", "up" } },
  // SW4
  { { "recents",  ""    }, { "restart",  "" }, { "dump",     "" } },
};

String token = "";
int baseline[SW_COUNT];
int touchThr[SW_COUNT];
bool pressed[SW_COUNT];
bool longFired[SW_COUNT];
bool needsSingle[SW_COUNT];
unsigned long pressAt[SW_COUNT];
unsigned long lastRelease[SW_COUNT];
unsigned long singleAt[SW_COUNT];

// Local toggle states for actions that flip rather than set.
bool torchOn = false;
bool rotOn = false;
int bri = 128;                 // 0..255, used by brightness_up/down

// =========================== HTTP helpers ===========================

String apiUrl(const char* path) {
  return String("http://") + LOCALHUB_HOST + ":" + LOCALHUB_PORT + path;
}

bool localhubLogin() {
  HTTPClient http;
  http.begin(apiUrl("/api/auth/login"));
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"username\":\"") + LH_USER +
                "\",\"password\":\"" + LH_PASS + "\",\"remember\":false}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();
  if (code == 200) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, resp);
    if (!err && doc["ok"].as<bool>()) {
      token = doc["token"].as<String>();
      Serial.println("[login] OK");
      return token.length() > 0;
    }
  }
  Serial.println("[login] FAILED " + String(code));
  return false;
}

// Generic authed POST. Re-logs-in once on 401. Returns HTTP code.
int postJson(const char* path, const String& body) {
  if (token.length() == 0 && !localhubLogin()) return -1;
  HTTPClient http;
  http.begin(apiUrl(path));
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + token);
  int code = http.POST(body);
  String resp = http.getString();
  http.end();
  Serial.printf("[%s] %d %s\n", path, code, resp.c_str());
  if (code == 401 && token.length()) {
    token = "";
    if (localhubLogin()) return postJson(path, body);
  }
  return code;
}

// Builds {action,value?,state?} and posts to /api/device/action.
void sendDevice(const char* action, const char* value = "", const char* state = "") {
  String body = String("{\"action\":\"") + action + "\"";
  if (strlen(value)) body += String(",\"value\":\"") + value + "\"";
  if (strlen(state)) body += String(",\"state\":\"") + state + "\"";
  body += "}";
  postJson("/api/device/action", body);
}

// Mirror (accessibility) endpoints — bina-root phone control.
void sendMirrorClick(const char* kind, const char* text) {
  String body = String("{\"kind\":\"") + kind + "\",\"text\":\"" + text + "\"}";
  postJson("/api/mirror/click", body);
}
void sendMirrorSwipe(const char* dir) {
  String body = String("{\"direction\":\"") + dir + "\"}";
  postJson("/api/mirror/swipe", body);
}
void sendMirrorType(const char* text) {
  String body = String("{\"text\":\"") + text + "\"}";
  postJson("/api/mirror/type", body);
}
void sendMirrorNav(const char* nav) {
  String body = String("{\"action\":\"") + nav + "\"}";
  postJson("/api/mirror/nav", body);
}
void sendMirrorDump() {
  postJson("/api/mirror/dump", "{}");
}

void logEvent(const String& msg) {
  String body = String("{\"message\":\"ESP32:") + msg + "\"}";
  postJson("/api/log", body);
}

// =========================== Action dispatcher ===========================

void fireAction(const Action& a) {
  if (!strcmp(a.type, "none") || strlen(a.type) == 0) return;

  if      (!strcmp(a.type, "torch"))      { torchOn = !torchOn; sendDevice("torch", "", torchOn ? "true" : "false"); }
  else if (!strcmp(a.type, "volume_up"))  sendDevice("volume_up");
  else if (!strcmp(a.type, "volume_down"))sendDevice("volume_down");
  else if (!strcmp(a.type, "volume"))     sendDevice("volume", a.param);
  else if (!strcmp(a.type, "mute"))       sendDevice("ringer", "silent");
  else if (!strcmp(a.type, "normal"))     sendDevice("ringer", "normal");
  else if (!strcmp(a.type, "vibrate"))    sendDevice("vibrate", strlen(a.param) ? a.param : "300");
  else if (!strcmp(a.type, "rotate"))     { rotOn = !rotOn; sendDevice("rotate", "", rotOn ? "true" : "false"); }
  else if (!strcmp(a.type, "brightness")) sendDevice("brightness", a.param);
  else if (!strcmp(a.type, "brightness_up"))  { bri = min(255, bri + 20); sendDevice("brightness", String(bri).c_str()); }
  else if (!strcmp(a.type, "brightness_down")){ bri = max(0, bri - 20); sendDevice("brightness", String(bri).c_str()); }
  else if (!strcmp(a.type, "open"))       sendDevice("open", a.param);
  else if (!strcmp(a.type, "screenshot")) sendDevice("screenshot");

  else if (!strcmp(a.type, "click"))      sendMirrorClick("click", a.param);
  else if (!strcmp(a.type, "longclick"))  sendMirrorClick("longpress", a.param);
  else if (!strcmp(a.type, "focus"))      sendMirrorClick("focus", a.param);
  else if (!strcmp(a.type, "scroll"))     sendMirrorClick("scroll", a.param);
  else if (!strcmp(a.type, "swipe"))      sendMirrorSwipe(a.param);
  else if (!strcmp(a.type, "type"))       sendMirrorType(a.param);
  else if (!strcmp(a.type, "back") ||
           !strcmp(a.type, "home") ||
           !strcmp(a.type, "recents"))    sendMirrorNav(a.type);
  else if (!strcmp(a.type, "dump"))       sendMirrorDump();

  else if (!strcmp(a.type, "restart"))    postJson("/api/server/restart", "{}");
  else if (!strcmp(a.type, "log"))        logEvent(String(a.param));
  else Serial.println("[action] unknown type: " + String(a.type));
}

// =========================== Touch calibration ===========================

int readCalibrated(uint8_t pin) {
  // Sample baseline over CAL_SAMPLES to find the untouched resting value.
  long sum = 0;
  for (int i = 0; i < CAL_SAMPLES; i++) { sum += touchRead(pin); delay(4); }
  int b = sum / CAL_SAMPLES;
  if (b <= TOUCH_DELTA) b = 60;            // fallback if ambient is odd
  return b;
}

// =========================== LED ===========================

void blinkLed(int times) {
  if (LED < 0) return;
  for (int i = 0; i < times; i++) {
    digitalWrite(LED, HIGH); delay(70); digitalWrite(LED, LOW); delay(70);
  }
}

// =========================== setup / loop ===========================

void setup() {
  Serial.begin(115200);
  delay(300);
  if (LED >= 0) { pinMode(LED, OUTPUT); digitalWrite(LED, LOW); }

  Serial.println("LocalHub TouchPad booting...");
  for (int i = 0; i < SW_COUNT; i++) {
    baseline[i]  = readCalibrated(SW_PINS[i]);
    touchThr[i]  = baseline[i] - TOUCH_DELTA;
    if (touchThr[i] < 3) touchThr[i] = 3;
    pressed[i] = longFired[i] = needsSingle[i] = false;
    pressAt[i] = lastRelease[i] = singleAt[i] = 0;
    Serial.printf("[touch] GPIO%d baseline=%d thr=%d\n", SW_PINS[i], baseline[i], touchThr[i]);
  }

  Serial.print("[wifi] connecting to "); Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) { delay(500); Serial.print("."); tries++; }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[wifi] IP = " + WiFi.localIP().toString());
    localhubLogin();
  } else {
    Serial.println("[wifi] FAILED to connect");
  }
  blinkLed(2);
}

void loop() {
  unsigned long now = millis();

  for (int i = 0; i < SW_COUNT; i++) {
    int v = touchRead(SW_PINS[i]);
    bool touched = (v < touchThr[i]);

    // ---- new press ----
    if (touched && !pressed[i]) {
      pressed[i] = true;
      longFired[i] = false;
      pressAt[i] = now;
      needsSingle[i] = false;   // a new touch cancels a pending single tap
    }

    // ---- held ----
    if (pressed[i] && !longFired[i] && (now - pressAt[i] >= HOLD_MS)) {
      longFired[i] = true;
      needsSingle[i] = false;
      Serial.printf("[SW%d] HOLD -> %s\n", i, ACTIONS[i].hold.type);
      fireAction(ACTIONS[i].hold);
      blinkLed(3);
    }

    // ---- release ----
    if (!touched && pressed[i]) {
      pressed[i] = false;
      if (!longFired[i]) {
        if ((now - lastRelease[i]) < DOUBLE_MS) {
          // second tap within window -> DOUBLE
          needsSingle[i] = false;
          Serial.printf("[SW%d] DOUBLE -> %s\n", i, ACTIONS[i].dbl.type);
          fireAction(ACTIONS[i].dbl);
          blinkLed(2);
          lastRelease[i] = 0;
        } else {
          // lone tap -> schedule single (gives double a chance)
          lastRelease[i] = now;
          needsSingle[i] = true;
          singleAt[i] = now + SINGLE_MS;
        }
      }
    }

    // ---- pending single tap ----
    if (needsSingle[i] && now >= singleAt[i]) {
      needsSingle[i] = false;
      Serial.printf("[SW%d] TAP -> %s\n", i, ACTIONS[i].tap.type);
      fireAction(ACTIONS[i].tap);
      blinkLed(1);
    }
  }

  delay(DEBOUNCE_MS);
}
