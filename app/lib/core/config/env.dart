/// Build-time configuration.
///
/// Values come from `--dart-define`, never from a checked-in file, so the
/// staging and production builds differ only by their build command:
///
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1
///   flutter build apk --release --dart-define=API_BASE_URL=https://api.example.com/api/v1
///
/// NOTHING SECRET BELONGS HERE. Anything compiled into the app can be read out
/// of the APK. Database credentials and payment provider keys live only on the
/// backend; this app talks to the API and nothing else.
class Env {
  const Env._();

  /// 10.0.2.2 is the host machine as seen from the Android emulator.
  /// A physical device needs the machine's LAN IP instead.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000/api/v1',
  );

  static const String appName = String.fromEnvironment(
    'APP_NAME',
    defaultValue: 'Ledger',
  );

  static const bool isProduction = bool.fromEnvironment('IS_PRODUCTION');

  /// Guards against shipping a release build that talks to an unencrypted API.
  static bool get isInsecureProductionConfig =>
      isProduction && !apiBaseUrl.startsWith('https://');
}
