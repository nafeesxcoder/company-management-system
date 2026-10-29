# Mobile app (Flutter)

The partner-facing phone client. It talks to the same `/api/v1` backend as the
web dashboard and performs **no financial arithmetic of its own** — every
figure, down to the profit margin, is what the API returned. That is what keeps
the phone and the dashboard from ever disagreeing.

- Flutter · Dart · Material 3
- Riverpod (state) · Dio (HTTP) · GoRouter (navigation)
- `flutter_secure_storage` for the refresh token (Keystore / Keychain)
- `fl_chart` for the trend chart
- `intl` for currency and date formatting

---

## 1. Generate the platform folders

This repository holds `lib/`, `test/` and `pubspec.yaml` — the code that is
actually written by hand. The `android/` and `ios/` folders are **generated**,
not authored, so they are not committed. Create them once after cloning:

```bash
cd app
flutter create --platforms=android,ios --org com.timexsolution --project-name company_management .
flutter pub get
```

`flutter create .` on an existing directory only fills in what is missing; it
does not overwrite `lib/`, `test/` or `pubspec.yaml`.

### Then apply these three changes

**a. Internet permission (required for release builds).**
Debug builds get it implicitly; release builds do not, and the app will fail
with connection errors that look like a backend problem. In
`android/app/src/main/AndroidManifest.xml`, above `<application>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

**b. Cleartext HTTP for local development only.**
A local backend is `http://`, and Android blocks cleartext by default. Add to
the `<application>` tag in the **debug** manifest
(`android/app/src/debug/AndroidManifest.xml` — create it if absent) rather than
the main one, so production stays HTTPS-only:

```xml
<application android:usesCleartextTraffic="true" />
```

**c. App display name.** In `android/app/src/main/AndroidManifest.xml`:

```xml
<application android:label="Ledger" ...>
```

For iOS, set `CFBundleDisplayName` to `Ledger` in `ios/Runner/Info.plist`.

---

## 2. Run it

The app takes its API URL at **build time** via `--dart-define`; there is no
runtime `.env`. See `.env.example` for the full set of commands.

```bash
# Android emulator — 10.0.2.2 is the host machine from inside the emulator
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1

# iOS simulator
flutter run --dart-define=API_BASE_URL=http://localhost:4000/api/v1

# Physical device on the same Wi-Fi — use your machine's LAN IP
flutter run --dart-define=API_BASE_URL=http://192.168.1.50:4000/api/v1
```

Sign in with an account that already exists. There is no sign-up in the app:
accounts are created by invitation from the web dashboard (Team → Invite a
partner), which is deliberate — this is a private two-partner system.

---

## 3. Tests

```bash
flutter test
```

Three suites, none of which need a device or a running backend:

| File | What it protects |
|---|---|
| `test/money_test.dart` | Formatting never rounds or re-scales; INR uses lakh/crore grouping; a missing amount renders as `—`, never `0` |
| `test/models_test.dart` | Parsing against **real captured API payloads** — if the backend renames a field, this fails here instead of showing em dashes on a partner's phone |
| `test/figure_widget_test.dart` | The money widget renders the API's string as-is and colours by sign only when asked |

---

## 4. Release build

```bash
flutter build apk --release \
  --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1 \
  --dart-define=IS_PRODUCTION=true

# For Play Store upload, an app bundle instead:
flutter build appbundle --release \
  --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1 \
  --dart-define=IS_PRODUCTION=true
```

`Env.isInsecureProductionConfig` trips if a production build points at a
non-HTTPS URL, so a release that would send partner financials in the clear
fails loudly instead of shipping.

Signing config (keystore, `key.properties`) is part of the generated `android/`
folder — see `docs/deployment.md`.

---

## 5. How the code is arranged

```
lib/
├── core/
│   ├── config/env.dart           build-time configuration
│   ├── network/api_client.dart   Dio + auth interceptor + single-flight refresh
│   ├── routing/app_router.dart   GoRouter, one redirect guards every route
│   ├── storage/                  refresh token in the platform keystore
│   ├── theme/                    Material 3 theme, gain/loss/pending colours
│   └── utils/money.dart          FORMATS money; never calculates it
├── features/                     auth · dashboard · projects · transactions
│                                 expenses · reports · partners · settings
└── shared/
    ├── models.dart               every monetary field is a String
    └── widgets/                  Figure, LedgerRow, PresetChips, state views
```

### Two decisions worth knowing

**Money is a `String` everywhere.** `double` is binary floating point and cannot
hold `1999.99` exactly. Amounts arrive as decimal strings, are stored as
strings, and are formatted as strings. `Money.toChartValue()` is the single
exception — charts need a `double` — and its result is never shown as a figure
or fed back into one.

**Models are hand-written, not generated.** No `freezed` / `build_runner` step,
so `flutter run` works straight after `pub get`. Each `fromJson` makes the
string handling explicit and auditable at every field, with no generated
converter that might quietly coerce an amount to a number.

### Token lifecycle

The access token lives in memory only. The refresh token goes to the platform
keystore via `flutter_secure_storage` (the web client uses an HttpOnly cookie,
which a native app has no equivalent of). On a 401 the client refreshes **once**
and replays the request; concurrent 401s share one in-flight refresh, because
firing several rotations at once would trip the backend's token-reuse detector
and kill the session.
