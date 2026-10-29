import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../../core/storage/secure_storage.dart';
import '../../shared/models.dart';

/// Session state and the providers everything else depends on.

final secureStorageProvider = Provider<SecureStorage>((ref) => SecureStorage());

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(storage: ref.watch(secureStorageProvider));
  client.onSessionExpired = () {
    // Clears session state; the router redirect then sends the user to sign-in.
    ref.read(authControllerProvider.notifier).handleSessionExpired();
  };
  return client;
});

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  const AuthState({
    this.status = AuthStatus.unknown,
    this.user,
    this.memberships = const [],
    this.activeCompanyId,
    this.errorMessage,
    this.isSubmitting = false,
  });

  final AuthStatus status;
  final SessionUser? user;
  final List<Membership> memberships;
  final String? activeCompanyId;
  final String? errorMessage;
  final bool isSubmitting;

  Membership? get activeCompany {
    if (memberships.isEmpty) return null;
    for (final membership in memberships) {
      if (membership.companyId == activeCompanyId) return membership;
    }
    return memberships.first;
  }

  String get currency => activeCompany?.baseCurrency ?? 'INR';
  bool get canWrite => activeCompany?.canWrite ?? false;
  bool get canAdminister => activeCompany?.canAdminister ?? false;

  AuthState copyWith({
    AuthStatus? status,
    SessionUser? user,
    List<Membership>? memberships,
    String? activeCompanyId,
    String? errorMessage,
    bool? isSubmitting,
    bool clearError = false,
    bool clearUser = false,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: clearUser ? null : (user ?? this.user),
      memberships: memberships ?? this.memberships,
      activeCompanyId: activeCompanyId ?? this.activeCompanyId,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      isSubmitting: isSubmitting ?? this.isSubmitting,
    );
  }
}

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref) : super(const AuthState()) {
    // Try to restore a session from the stored refresh token on launch.
    restoreSession();
  }

  final Ref _ref;

  ApiClient get _api => _ref.read(apiClientProvider);
  SecureStorage get _storage => _ref.read(secureStorageProvider);

  /// Rotates the stored refresh token for an access token, then loads the
  /// profile. Any failure means the user signs in again.
  Future<void> restoreSession() async {
    final refreshToken = await _storage.readRefreshToken();
    if (refreshToken == null) {
      state = state.copyWith(status: AuthStatus.unauthenticated);
      return;
    }

    try {
      final refreshed = await _api.post(
        '/auth/refresh',
        body: {'refreshToken': refreshToken, 'client': 'mobile'},
      );

      final accessToken = refreshed['accessToken'] as String?;
      if (accessToken == null) throw const ApiException(
            message: 'Session could not be restored.',
            code: 'TOKEN_INVALID',
            statusCode: 401,
          );

      _api.setAccessToken(accessToken);
      final newRefresh = refreshed['refreshToken'] as String?;
      if (newRefresh != null) await _storage.writeRefreshToken(newRefresh);

      final profile = await _api.get('/auth/me');
      final memberships = (profile['memberships'] as List<dynamic>? ?? [])
          .map((m) => Membership.fromProfileJson(m as Map<String, dynamic>))
          .toList();

      final storedCompanyId = await _storage.readActiveCompanyId();
      final activeId = memberships.any((m) => m.companyId == storedCompanyId)
          ? storedCompanyId
          : (memberships.isEmpty ? null : memberships.first.companyId);

      _api.setActiveCompanyId(activeId);

      state = AuthState(
        status: AuthStatus.authenticated,
        user: SessionUser.fromJson(profile),
        memberships: memberships,
        activeCompanyId: activeId,
      );
    } catch (_) {
      await _storage.clearAll();
      _api.setAccessToken(null);
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
  }

  Future<bool> login({required String email, required String password}) async {
    state = state.copyWith(isSubmitting: true, clearError: true);

    try {
      final result = LoginResult.fromJson(
        await _api.post(
          '/auth/login',
          // `mobile` makes the API return the refresh token in the body rather
          // than as a cookie — a native app has no cookie jar to rely on.
          body: {'email': email, 'password': password, 'client': 'mobile'},
        ),
      );

      _api.setAccessToken(result.accessToken);
      if (result.refreshToken != null) {
        await _storage.writeRefreshToken(result.refreshToken!);
      }

      final activeId =
          result.memberships.isEmpty ? null : result.memberships.first.companyId;
      if (activeId != null) await _storage.writeActiveCompanyId(activeId);
      _api.setActiveCompanyId(activeId);

      state = AuthState(
        status: AuthStatus.authenticated,
        user: result.user,
        memberships: result.memberships,
        activeCompanyId: activeId,
      );
      return true;
    } catch (error) {
      final failure = ApiException.from(error);
      state = state.copyWith(isSubmitting: false, errorMessage: failure.message);
      return false;
    }
  }

  Future<void> logout() async {
    final refreshToken = await _storage.readRefreshToken();
    try {
      await _api.post('/auth/logout', body: {'refreshToken': refreshToken});
    } catch (_) {
      // Signing out locally must succeed even if the call fails.
    }
    await _storage.clearAll();
    _api.setAccessToken(null);
    _api.setActiveCompanyId(null);
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  void handleSessionExpired() {
    _api.setAccessToken(null);
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  Future<void> switchCompany(String companyId) async {
    if (!state.memberships.any((m) => m.companyId == companyId)) return;
    await _storage.writeActiveCompanyId(companyId);
    _api.setActiveCompanyId(companyId);
    state = state.copyWith(activeCompanyId: companyId);
    // Figures are company-scoped, so nothing cached may carry over.
    _ref.invalidate(dashboardProvider);
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((ref) => AuthController(ref));

/// Declared here so AuthController can invalidate it on a company switch
/// without a circular import. Implemented in features/dashboard.
final dashboardProvider = FutureProvider.autoDispose
    .family<Dashboard, String>((ref, preset) async {
  final api = ref.watch(apiClientProvider);
  final json = await api.get('/dashboard', query: {'preset': preset});
  return Dashboard.fromJson(json);
});
