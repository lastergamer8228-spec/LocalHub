/*
 * LocalHub Remote — ESP32 physical button remote for LocalHub
 * ----------------------------------------------------------------------------
 * Turns an ESP32 + 2 touch-sensitive buttons into a physical control remote
 * for your LocalHub phone server.
 *
 *   BUTTON 1  -> toggle flashlight (torch)
 *   BUTTON 2  -> volume up
 *   BUTTON 2 (long press ~1.5s) -> restart LocalHub server
 *
 * How it works:
 *   1. Connects to your Wi-Fi
 *   2. Logs into LocalHub to get an admin token (Bearer)
 *   3. On each button press, POSTs the mapped action to /api/device/action
 *   4. Shows status on the serial monitor (and optional OLED/LED if wired)
 *
 * Wiring (typical):
 *   - Touch button 1: GPIO 4 (capacitive touch, works out of the box)
 *   - Touch button 2: GPIO 15
 *   - (Optional) status LED: GPIO 2
 *
 * REQUIRED BOARD LIBRARY: none extra — uses built-in WiFi + HTTPClient + TouchRead.
 * Tested on ESP32 DevKit / ESP32-WROOM.
 *
 * Configure the values below for your network + LocalHub server.
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ===================== CONFIG =====================
const char* WIFI_SSID = "YourWiFiSSID";
const char* WIFI_PASS = "YourWiFiPassword";

// Your phone's IP + the LocalHub port
const char* LOCALHUB_HOST = "192.168.0.108";
const uint16_t LOCALHUB_PORT = 8080;

// LocalHub admin credentials (use the admin account)
const char* LH_USER = "admin";
const char* LH_PASS = "admin";

// Touch button GPIOs
#define BTN1 4
#define BTN2 15

// Optional status LED (set to -1 to disable)
#define LED 2

// Touch sensitivity — an ADAPTIVE threshold is auto-calibrated at boot based on
// each pin's ambient (untouched) reading, so it works reliably across different
// board/finger conditions. TOUCH_DELTA just tunes how much a touch must drop the
// reading (lower = more sensitive).
#define TOUCH_DELTA 28
#define CAL_SAMPLES 20
// ==================================================

String token = "";
unsigned long lastPress1 = 0;
unsigned long lastPress2 = 0;
bool btn1State = false;

// Adaptive touch thresholds, calibrated in setup().
int thr1 = 30, thr2 = 30;

int calibrateTouch(uint8_t pin) {
  long sum = 0;
  for (int i = 0; i < CAL_SAMPLES; i++) { sum += touchRead(pin); delay(4); }
  int b = sum / CAL_SAMPLES;
  if (b <= TOUCH_DELTA) b = 60;
  return b;
}

String apiUrl(const char* path) {
  return String("http://") + LOCALHUB_HOST + ":" + LOCALHUB_PORT + path;
}

bool localhubLogin() {
  HTTPClient http;
  http.begin(apiUrl("/api/auth/login"));
  http.addHeader("Content-Type", "application/json");
  // Build a JSON body for the credentials.
  String body = String("{\"username\":\"") + LH_USER + "\",\"password\":\"" + LH_PASS + "\",\"remember\":false}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  if (code == 200) {
    // Parse the token from the JSON response.
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, resp);
    if (!err && doc["ok"].as<bool>()) {
      token = doc["token"].as<String>();
      Serial.println("[login] OK — token acquired");
      return token.length() > 0;
    }
  }
  Serial.println("[login] FAILED (code " + String(code) + "): " + resp);
  return false;
}

// Sends an admin action to LocalHub. Returns true on HTTP 200 + ok:true.
bool sendAction(const char* action, const char* value, const char* state) {
  if (token.length() == 0) {
    if (!localhubLogin()) return false;
  }
  HTTPClient http;
  http.begin(apiUrl("/api/device/action"));
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + token);

  String body = String("{\"action\":\"") + action + "\"";
  if (value) body += String(",\"value\":\"") + value + "\"";
  if (state) body += String(",\"state\":\"") + state + "\"";
  body += "}";

  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  if (code == 200) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, resp);
    bool ok = !err && doc["ok"].as<bool>();
    Serial.printf("[%s] -> %s %d ok=%d\n", action, resp.c_str(), code, ok ? 1 : 0);
    return ok;
  }
  // Token may have expired — retry once after re-login.
  if (code == 401) {
    token = "";
    if (localhubLogin()) return sendAction(action, value, state);
  }
  Serial.printf("[%s] HTTP %d\n", action, code);
  return false;
}

void pressLed() {
  if (LED >= 0) { digitalWrite(LED, HIGH); delay(80); digitalWrite(LED, LOW); }
}

// Logs an event to LocalHub's access log so it shows up in the admin view.
// Uses the existing /api/log endpoint (admin).
void logEvent(String msg) {
  if (token.length() == 0 && !localhubLogin()) return;
  HTTPClient http;
  http.begin(apiUrl("/api/log"));
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + token);
  String body = String("{\"message\":\"ESP32: ") + msg + "\"}";
  http.POST(body);
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(300);
  if (LED >= 0) { pinMode(LED, OUTPUT); digitalWrite(LED, LOW); }

  Serial.print("[wifi] connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();
  // Calibrate adaptive touch thresholds for each button.
  thr1 = calibrateTouch(BTN1) - TOUCH_DELTA;
  thr2 = calibrateTouch(BTN2) - TOUCH_DELTA;
  if (thr1 < 3) thr1 = 3;
  if (thr2 < 3) thr2 = 3;
  Serial.printf("[touch] btn1 thr=%d btn2 thr=%d\n", thr1, thr2);

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[wifi] connected, IP = " + WiFi.localIP().toString());
    Serial.println("[wifi] logging into LocalHub...");
    localhubLogin();
  } else {
    Serial.println("[wifi] FAILED to connect");
  }
}

void loop() {
  unsigned long now = millis();
  int t1 = touchRead(BTN1);
  int t2 = touchRead(BTN2);

  // ---- BUTTON 1: toggle flashlight ----
  // Track the torch state locally and send the opposite each press.
  static bool torchState = false;
  bool touched1 = (t1 < thr1);
  if (touched1 && !btn1State) {
    btn1State = true;
    torchState = !torchState;
    Serial.printf("[btn1] touch=%d torch -> %s\n", t1, torchState ? "ON" : "OFF");
    sendAction("torch", NULL, torchState ? "true" : "false");
    logEvent("Button1 flashlight " + String(torchState ? "on" : "off"));
    pressLed();
  }
  if (!touched1) btn1State = false;

  // ---- BUTTON 2: single = volume up, long press = restart server ----
  static bool btn2Held = false;
  bool touched2 = (t2 < thr2);
  if (touched2 && !btn2Held) {
    btn2Held = true;
    lastPress2 = now;
    Serial.printf("[btn2] touch=%d\n", t2);
  }
  if (btn2Held && touched2 && (now - lastPress2 > 1500)) {
    // Long press: restart LocalHub server
    Serial.println("[btn2] LONG PRESS -> restart server");
    if (token.length() == 0 && !localhubLogin()) { /* retry login */ }
    HTTPClient http;
    http.begin(apiUrl("/api/server/restart"));
    http.addHeader("Content-Type", "application/json");
    if (token.length()) http.addHeader("Authorization", "Bearer " + token);
    int code = http.POST("{}");
    http.end();
    Serial.printf("[restart] HTTP %d\n", code);
    logEvent("Button2 long-press restart");
    pressLed();
    btn2Held = false;
    delay(500);
  }
  if (!touched2 && btn2Held) {
    // Released without long-press -> single tap = volume up
    if (now - lastPress2 < 1500) {
      Serial.println("[btn2] single -> volume up");
      sendAction("volume_up", NULL, NULL);
      logEvent("Button2 volume up");
      pressLed();
    }
    btn2Held = false;
  }

  delay(50);
}
