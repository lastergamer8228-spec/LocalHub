# LocalHub ESP32 — Physical Remote & Touch Switch Control

Turn an **ESP32** into a physical remote for your LocalHub phone server using the
ESP32's **built-in capacitive touch pins** — so you can use bare wires, foil, or
copper pads as touch switches, with no extra buttons or resistors.

Everything runs over your local Wi-Fi using LocalHub's own REST API — **no cloud**,
fully offline on your LAN.

There are **two sketches** (pick whichever fits):

| Sketch | Best for | Touch switches | Gestures |
|--------|----------|---------------|----------|
| `LocalHubRemote/` | Beginner / 2-button starter | 2 | tap + hold |
| `LocalHubTouchPad/` | Power user / peak control | up to 4+ | tap, hold, double-tap |

Both auto-calibrate each pin's touch baseline at boot, so they work reliably across
different boards and finger sizes without manual tuning.

---

## Option A — `LocalHubRemote` (simple 2-touch)

- **SW1** → toggle flashlight
- **SW2 (tap)** → volume up
- **SW2 (hold ~1.5s)** → restart the LocalHub server

Uses GPIO 4 (T0) and GPIO 15 (T3). Optional status LED on GPIO 2.

---

## Option B — `LocalHubTouchPad` (peak, multi-touch + gestures)

Up to **4 touch switches** (configurable), each supporting **3 gestures**, all mapped
to LocalHub's **bina-root** phone-control actions:

| Switch | GPIO (touch ch) | TAP | HOLD | DOUBLE |
|--------|-----------------|-----|------|--------|
| SW1 | 4 (T0) | torch | back | home |
| SW2 | 15 (T3) | volume up | volume down | mute |
| SW3 | 13 (T4) | swipe up | swipe down | scroll up |
| SW4 | 12 (T5) | recents | restart | dump screen |

### Action types you can assign to any gesture

**Device actions** (`/api/device/action`):
`torch`, `volume_up`, `volume_down`, `volume`, `mute`, `normal`, `vibrate`,
`rotate`, `brightness`, `brightness_up`, `brightness_down`, `open`, `screenshot`

**Bina-root accessibility control** (needs Remote Access enabled in LocalHub):
`click` (by label/description/id), `longclick`, `focus`, `scroll` (up/down/top/bottom),
`swipe` (left/right/up/down), `type` (type text into focused field), `back`, `home`,
`recents`, `dump` (dump what's on screen)

**System / other:**
`restart` (restart LocalHub server), `log` (write to LocalHub's access log), `none`

Edit the `ACTIONS[]` table near the top of the sketch to remap everything.

### Adding a 5th / 6th switch

Add a pin to `SW_PINS[]` and matching entries to `ACTIONS[]`. ESP32 capacitive touch
channels available: **T0=GPIO4, T1=GPIO0, T2=GPIO2, T3=GPIO15, T4=GPIO13,
T5=GPIO12, T6=GPIO14, T7=GPIO27, T8=GPIO33, T9=GPIO32**.

---

## What you need
- 1× ESP32 (DevKit / WROOM / WROVER)
- 1× LocalHub running on your phone (server started, port 8080)
- (optional) a few lengths of wire / foil as touch pads, and a status LED

## Wiring

| ESP32 Pin | Connected to |
|-----------|--------------|
| GPIO 4 | Touch switch 1 (capacitive touch — no pull-up needed) |
| GPIO 15 | Touch switch 2 |
| GPIO 13 | Touch switch 3 (TouchPad only) |
| GPIO 12 | Touch switch 4 (TouchPad only) |
| GPIO 2 | (optional) status LED through a resistor |

> Capacitive touch needs no resistors. Bare exposed wire or foil taped to the pin
> works as a touch pad. If you use long wires, keep them away from the antenna for
> stable Wi-Fi.

---

## Configure

Open the sketch in **Arduino IDE** and set:

```cpp
const char* WIFI_SSID  = "YourWiFiSSID";
const char* WIFI_PASS  = "YourWiFiPassword";

const char* LOCALHUB_HOST = "192.168.0.108";   // your phone's IP
const uint16_t LOCALHUB_PORT = 8080;

const char* LH_USER = "admin";   // LocalHub admin account
const char* LH_PASS = "admin";
```

Install the **ArduinoJson** library (Library Manager → "ArduinoJson" by
Benoit Blanchon). Select **ESP32 Dev Module** and flash.

---

## How it works
1. On boot the ESP32 connects to Wi-Fi and **auto-calibrates** each touch pin's
   baseline.
2. It logs into LocalHub (`POST /api/auth/login`) to get an **admin token**.
3. On each gesture it POSTs the mapped action (e.g. `POST /api/device/action`,
   `POST /api/mirror/click`, `POST /api/mirror/swipe`, `POST /api/mirror/nav`,
   `POST /api/server/restart`).
4. Status prints to Serial Monitor (115200 baud); LED blinks (1=tap, 2=double,
   3=hold).

The token is reused; if a request returns **401** the ESP32 re-logs-in automatically.

---

## Security notes
- The ESP32 uses the **admin** credentials, so keep `LH_USER/LH_PASS` on a trusted
  device. Do not share the sketch with those values publicly.
- All traffic is plain HTTP on your LAN (LocalHub default). For encryption enable
  LocalHub's optional HTTPS and change the URLs to `https://` (needs
  `WiFiClientSecure` + certificate config).
- These are admin actions — the ESP32 is effectively an **admin remote**, so place
  it somewhere trusted.

---

## Troubleshooting
| Symptom | Fix |
|---------|-----|
| Serial shows `[wifi] FAILED` | Wrong SSID/password, or phone/ESP32 not on same network. |
| `[login] FAILED` | Wrong admin user/pass, or LocalHub server not running. |
| Touch switch too sensitive / not sensitive | Adjust `TOUCH_DELTA` (lower = more sensitive). |
| Ghost presses | Raise `TOUCH_DELTA`; make sure touch pads aren't near power/ground noise. |
| Mirror actions do nothing | Enable **Remote Access** (Accessibility) in LocalHub settings. |
| Restart does nothing | Confirm token works; check the LocalHub access log. |

---

## Ideas to extend
- Add an OLED to show live status (CPU%, clients, last action).
- Add a DHT22 temperature/humidity sensor → POST to LocalHub.
- Use the `swipe`/`click` actions to build a real physical **scroller** for reading
  feeds, Instagram, or the LocalHub file manager.
- Combine with the ESP32-CAM for a doorbell-style remote with a camera.
