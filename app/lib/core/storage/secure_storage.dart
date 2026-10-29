import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Token storage.
///
/// The refresh token is long-lived, so it goes in the platform keystore
/// (EncryptedSharedPreferences on Android, Keychain on iOS) rather than in
/// SharedPreferences, which is readable on a rooted device.
///
/// The ACCESS token is deliberately NOT persisted. It lives in memory for its
/// ~15 minutes and is re-minted from the refresh token on app start, so a
/// device dump cannot yield a usable bearer token.
class SecureStorage {
  SecureStorage({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  final FlutterSecureStorage _storage;

  static const _refreshTokenKey = 'cms_refresh_token';
  static const _activeCompanyKey = 'cms_active_company_id';

  Future<String?> readRefreshToken() => _storage.read(key: _refreshTokenKey);

  Future<void> writeRefreshToken(String token) =>
      _storage.write(key: _refreshTokenKey, value: token);

  Future<void> clearRefreshToken() => _storage.delete(key: _refreshTokenKey);

  Future<String?> readActiveCompanyId() => _storage.read(key: _activeCompanyKey);

  Future<void> writeActiveCompanyId(String companyId) =>
      _storage.write(key: _activeCompanyKey, value: companyId);

  /// Called on sign-out and whenever the session is rejected.
  Future<void> clearAll() async {
    await _storage.delete(key: _refreshTokenKey);
    await _storage.delete(key: _activeCompanyKey);
  }
}
