# Push Notifications (Expo)

End-to-end Expo push notifications across iOS, Android, and web for Zenlot,
following Expo's official approach: [`expo-notifications`](https://docs.expo.dev/push-notifications/overview/)
on the client, [`expo-server-sdk`](https://github.com/expo/expo-server-sdk-node)
on the server, delivered through the Expo Push API.

> This file lives in `zenlot-server`. The client repo (`zenlot`) has a short
> pointer at `PUSH_NOTIFICATIONS.md` back to this document.

---

## 1. Architecture

```
                         trigger sites (server)
   trade auto-close ┐   coaching ready ┐   governance ┐   drawdown ┐   reminders (cron)
                    └──────────────────┴──────────────┴────────────┴───────────┐
                                                                                ▼
                                                      NotificationsService.dispatch()
                                                      • load user locale + timezone
                                                      • load notificationPreference
                                                      • build localized copy (en/fr)
                                                      • gate: master switch + category + quiet hours
                                                      • fetch enabled pushTokens
                                                                                ▼
                                                      ExpoPushService.send()
                                                      • chunk, sendPushNotificationsAsync
                                                      • map tickets → tokens
                                                      • poll receipts
                                                      • return {sentTokens, invalidTokens}
                                                                                ▼
                                                      PushTokenService
                                                      • markUsed(sent)
                                                      • disableTokens(invalid)  ← DeviceNotRegistered
                                                                                ▼
                                                          Expo Push API  ──►  APNs / FCM / web push
                                                                                ▼
                                                                device (expo-notifications)
                                                      • foreground handler (banner+sound)
                                                      • tap → deep link via expo-router (data.route)
```

The client registers its Expo push token with the server **after** auth is
established (so it never interferes with the load-bearing AuthProvider
persist-then-authenticate ordering), and manages per-category preferences from a
settings screen.

### Why push *and* WebSocket?

The app already streams `trade-closed` and `coaching_ready` over Socket.IO, but
that only reaches a **foregrounded** device. Push fills the gap when the app is
backgrounded or closed. Both fire; the client de-dupes naturally (the WS path
updates in-app state, the push is the out-of-app nudge).

---

## 2. Data model

Two new Prisma models (`prisma/schema.prisma`), migration
`prisma/migrations/20260623150000_add_push_notifications/`:

### `pushToken` — one row per user device

| column        | type      | notes |
|---------------|-----------|-------|
| `id`          | uuid PK   | |
| `userId`      | FK→user   | cascade delete |
| `token`       | string    | **unique** Expo token `ExponentPushToken[…]` |
| `platform`    | string    | `ios` \| `android` \| `web` |
| `deviceId`    | string?   | stable per-install id; **unique with userId** |
| `deviceName`  | string?   | |
| `enabled`     | bool      | soft-disabled on `DeviceNotRegistered` |
| `lastError`, `lastErrorAt`, `lastUsedAt` | | diagnostics / housekeeping |

Multiple devices per user are supported. Re-registration is idempotent: same
`(userId, deviceId)` updates in place (handles token rotation); a token already
owned by another user (recycled device) is re-pointed and re-enabled.

### `notificationPreference` — one row per user

Master `pushEnabled` switch + per-category toggles (`tradeClosed`,
`coachingReady`, `drawdownAlerts`, `governanceAlerts`, `journalReminders`),
optional quiet hours (`quietHoursStart`/`quietHoursEnd`, local `"HH:mm"`), and
the journaling reminder schedule (`reminderHour`, `lastReminderLocalDate`).
Lazily created with supportive defaults (everything on, no quiet hours,
reminder at 20:00 local).

Quiet hours and the reminder schedule are evaluated against the user's IANA
`timezone` via `Intl` (DST-safe, no stored offsets) — the same approach the
drawdown circuit-breaker reset uses.

---

## 3. Triggers

| Trigger | Fires from | Urgency | Respects quiet hours? |
|---------|-----------|---------|----------------------|
| **Trade auto-closed (profit/loss)** | `src/trade/trade-auto-close.service.ts` after `emitTradeClosed` | urgent | no (real-money event) |
| **AI coaching ready** | `src/risk/coaching/coaching.processor.ts` after `emitCoachingReady` | gentle | yes — carries the coaching text (see below) |
| **Drawdown / risk alert** | auto-close + manual close (`trade-log.service.ts`) when a breaker newly trips (`daily/weekly/monthlyBreached` false→true) | urgent | no |
| **Governance / rule violation** | `src/risk/trade-log.service.ts` when a trade is logged overriding a blocking rule | gentle | yes |
| **Journaling / discipline reminder** | `src/notifications/journal-reminder.processor.ts` (hourly cron) at the user's local `reminderHour`, once per local day | gentle | yes |

**AI coaching is embedded in the notification.** The in-app `coaching_ready`
toast is ephemeral (45s) and only shows when the app is foregrounded, so the push
carries the coaching itself: the cleaned coaching text becomes the notification
**body** (visible and persistent in the tray) and the full text rides in
`data.coaching` (capped to stay under the ~4KB push payload limit). On the client,
tapping a coaching notification re-surfaces the full reflection via the same toast
the WebSocket path uses, so the trader can always read it — even long after it
first arrived. See `buildCoachingReadyContent` in `notification.copy.ts`.

All trigger calls are **best-effort**: `NotificationsService` swallows its own
errors, so a push failure can never break a trade close, coaching job, etc.

### Copy & tone

Copy lives in `src/notifications/notification.copy.ts`, in **en + fr**. It is
deliberately calm and supportive (this is a trading-psychology product):
wins are acknowledged without hype, losses/breaches are framed as the risk
system protecting the trader (never punitive), reminders are gentle invitations.
Client-facing copy mirrors this in `localization/{english,french}.ts` under the
`notifications` key.

---

## 4. Client flow (`zenlot`)

- **Config:** `app.json` registers the `expo-notifications` plugin (icon, color,
  default Android channel) and bundles the notification icon asset.
- **Registration:** `providers/NotificationProvider.tsx` (mounted in the
  protected layout) calls `lib/notifications.ts → registerForPushNotifications()`
  once `isAuthenticated && user.id` are available. That function requests OS
  permission, creates the Android channel, fetches the Expo token (requires the
  EAS `projectId`, already in `app.json`), and POSTs it to the server.
- **API:** `api/notifications.ts` (follows the `api/user.ts` pattern; uses the
  shared `api/index.ts` wrapper that attaches the token fresh and refreshes on
  401).
- **Foreground:** `foregroundNotificationHandler` shows a banner + sound even
  when the app is open.
- **Deep linking:** every push carries `data.route`; tapping it routes via
  expo-router (`router.push(data.route)`), including cold starts
  (`getLastNotificationResponseAsync`).
- **Preferences screen:** `app/(protected)/(profile)/notifications.tsx`, linked
  from the Profile menu (`testID="profile-notifications"`).
- **Logout:** `AuthProvider.logout` calls `unregisterPushNotifications()` first.

### Web, simulators

- **Simulators/emulators** cannot receive push tokens — registration cleanly
  **skips** (`reason: 'not-a-physical-device'`).
- **Web** is best-effort. Expo web push needs additional VAPID keys + a service
  worker per [Expo's web push support](https://docs.expo.dev/push-notifications/what-you-need-to-know/#web);
  until that is configured, web registration **skips** gracefully
  (`reason: 'web-push-unavailable'`) rather than erroring. The data model and
  server pipeline already accept `platform: 'web'` tokens, so enabling web push
  later is config-only.

### Notification icon asset — action needed (Inclusive Visuals)

`assets/images/notification/zenlot_notification_icon.png` is currently a 96×96
**RGBA transparent** crop of the existing transparent favicon. Android strips
all color from the notification icon and renders only the **alpha silhouette**,
tinted with the `color` in `app.json` (`#001c34`). A transparent-background logo
therefore works, but for the cleanest result replace it with a purpose-built
asset:

- **96×96 px** (Android density-independent baseline; provide larger if desired).
- **White (or fully opaque) silhouette on a fully transparent background** —
  no gradients, no background fill (a non-alpha/solid image renders as a white
  square).
- Simple, recognizable mark; legible at ~24 px in the status bar.
- iOS uses the app icon for the small badge and your asset for rich content, so
  the same transparent mark is fine there.

---

## 5. EAS credentials runbook (manual — not done by code)

Push **code** is platform-correct and complete, but credentials must be set up
manually. Do this from the `zenlot` (client) repo. None of the steps below have
been run for you.

### 5.1 iOS — APNs key

1. In the Apple Developer portal → **Certificates, Identifiers & Profiles →
   Keys**, create an **APNs Auth Key** (`.p8`). Note the **Key ID** and your
   **Team ID**. Download the `.p8` (you can only download it once).
2. From the client repo run:
   ```bash
   eas credentials -p ios
   ```
   Choose your build profile → **Push Notifications: Manage your Apple Push
   Notifications Key** → **Set up Push Notifications** → upload the `.p8` (or let
   EAS create one for you). Confirm the bundle id is `com.zenlot.app`.
3. Verify: `eas credentials -p ios` shows a configured **Push Key**.

### 5.2 Android — FCM V1 service account

1. In the [Firebase console](https://console.firebase.google.com/), create (or
   open) a project, add an **Android app** with package `com.zenlot.app`.
2. **Project settings → Service accounts → Generate new private key** → download
   the service-account **JSON**.
3. From the client repo run:
   ```bash
   eas credentials -p android
   ```
   Choose your build profile → **Google Service Account → Manage your Google
   Service Account Key for Push Notifications (FCM V1)** → upload the JSON.
4. Verify: `eas credentials -p android` shows the **FCM V1 service account key**
   configured.

> FCM **legacy** server keys are deprecated — use **FCM V1** (service account
> JSON), which is what current `expo-server-sdk` + Expo Push API expect.

### 5.3 (Recommended) Expo access token for the server

Create an Expo access token (Expo dashboard → Account → Access tokens) and set
it on the **server** as `EXPO_ACCESS_TOKEN`. `ExpoPushService` reads it. It is
optional unless you enable *Enhanced Security for Push Notifications* on the Expo
project, in which case it becomes **required**.

### 5.4 Build

After credentials are set, build a dev or production client:
```bash
eas build -p ios --profile development     # or production
eas build -p android --profile development
```
(Plugin/native changes from this work require a new native build — Expo Go does
not support custom push credentials. `newArchEnabled` is already on.)

---

## 6. Testing end-to-end on a physical device

1. Install a dev/production build (above) on a **real device** (push tokens do
   not work on simulators).
2. Log in. `NotificationProvider` will prompt for permission and register the
   token. Confirm a `pushToken` row exists for your user
   (`platform`, `deviceId`, `enabled = true`).
3. Quick smoke test with Expo's tool — grab the token (log it in
   `registerForPushNotifications`, or read it from the DB) and use the
   [Expo Push Notifications Tool](https://expo.dev/notifications), or:
   ```bash
   curl -X POST https://exp.host/--/api/v2/push/send \
     -H "Content-Type: application/json" \
     -d '{
       "to": "ExponentPushToken[xxxxxxxx]",
       "title": "EURUSD hit your target",
       "body": "Closed in profit +$123.45.",
       "data": { "route": "/(protected)/(tabs)/history" }
     }'
   ```
   Background the app, send it, tap the notification → the app should deep-link
   to History.
4. Exercise the real triggers: open a trade with a tight TP and let the
   auto-close scan close it (notification: trade closed); log a trade that
   overrides a rule (governance); breach a drawdown limit (risk alert).
5. Toggle categories / master switch on the **Notifications** settings screen and
   re-test that muted categories no longer arrive.

### Server unit tests

```bash
# from zenlot-server
npx jest src/notifications
```
Covers quiet-hours/timezone logic, the Expo send pipeline (chunking, ticket +
receipt `DeviceNotRegistered` detection), and dispatch gating.

### Client unit tests

```bash
# from zenlot
yarn jest __tests__/lib/notifications-test.ts __tests__/api/notifications-test.ts
```
Covers registration gating (simulator/permission/happy path, device-id
persistence), deep-link route resolution, and the API module.

---

## 7. Environment variables

| var | repo | purpose |
|-----|------|---------|
| `EXPO_ACCESS_TOKEN` | server | optional Expo access token for the push API |

No new **client** env vars — the EAS `projectId` is already in `app.json`.
