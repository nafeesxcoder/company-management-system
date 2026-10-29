import 'dart:async';

import 'package:dio/dio.dart';

import '../config/env.dart';
import '../storage/secure_storage.dart';
import 'api_exception.dart';

/// The single HTTP client.
///
/// Token lifecycle on mobile differs from the web:
///   - the REFRESH token is stored in the platform keystore (web uses an
///     HttpOnly cookie, which a native app has no equivalent of);
///   - the ACCESS token stays in memory only.
///
/// On a 401 the client refreshes ONCE and replays the failed request. Requests
/// that 401 while a refresh is already running wait for it rather than each
/// starting their own — firing several rotations at once would trip the
/// backend's token-reuse detector and kill the session.
class ApiClient {
  ApiClient({required SecureStorage storage, Dio? dio})
      : _storage = storage,
        _dio = dio ?? Dio() {
    _dio.options
      ..baseUrl = Env.apiBaseUrl
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 30)
      ..sendTimeout = const Duration(seconds: 30)
      ..headers = {'Content-Type': 'application/json'}
      // Never throw on a non-2xx; the interceptor turns it into an ApiException.
      ..validateStatus = (status) => status != null && status < 500;

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: _onRequest,
        onResponse: _onResponse,
        onError: _onError,
      ),
    );
  }

  final Dio _dio;
  final SecureStorage _storage;

  String? _accessToken;
  String? _activeCompanyId;
  Future<String?>? _refreshInFlight;

  /// Called when the session cannot be recovered; the app routes to sign-in.
  void Function()? onSessionExpired;

  Dio get dio => _dio;

  void setAccessToken(String? token) => _accessToken = token;

  String? get accessToken => _accessToken;

  void setActiveCompanyId(String? companyId) => _activeCompanyId = companyId;

  void _onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (_accessToken != null) {
      options.headers['Authorization'] = 'Bearer $_accessToken';
    }
    if (_activeCompanyId != null) {
      options.headers['X-Company-Id'] = _activeCompanyId;
    }
    handler.next(options);
  }

  Future<void> _onResponse(Response response, ResponseInterceptorHandler handler) async {
    final status = response.statusCode ?? 0;

    // Because validateStatus lets 4xx through, error responses land here.
    if (status >= 400) {
      final isAuthCall = response.requestOptions.path.contains('/auth/login') ||
          response.requestOptions.path.contains('/auth/refresh');

      if (status == 401 && !isAuthCall && response.requestOptions.extra['retried'] != true) {
        final refreshed = await _refreshAccessToken();
        if (refreshed != null) {
          try {
            final replayed = await _replay(response.requestOptions);
            return handler.resolve(replayed);
          } catch (_) {
            // Fall through to the error below.
          }
        } else {
          onSessionExpired?.call();
        }
      }

      return handler.reject(
        DioException(
          requestOptions: response.requestOptions,
          response: response,
          error: ApiException.fromResponse(response),
          type: DioExceptionType.badResponse,
        ),
      );
    }

    handler.next(response);
  }

  Future<Response<dynamic>> _replay(RequestOptions options) {
    return _dio.request<dynamic>(
      options.path,
      data: options.data,
      queryParameters: options.queryParameters,
      options: Options(
        method: options.method,
        headers: {...options.headers, 'Authorization': 'Bearer $_accessToken'},
        responseType: options.responseType,
        // Marked so a second 401 does not loop.
        extra: {...options.extra, 'retried': true},
      ),
    );
  }

  void _onError(DioException error, ErrorInterceptorHandler handler) {
    if (error.error is ApiException) return handler.next(error);

    handler.next(
      DioException(
        requestOptions: error.requestOptions,
        response: error.response,
        type: error.type,
        error: ApiException.fromDioException(error),
      ),
    );
  }

  /// Rotates the refresh token. Concurrent callers share one in-flight call.
  Future<String?> _refreshAccessToken() {
    return _refreshInFlight ??= _performRefresh().whenComplete(() {
      _refreshInFlight = null;
    });
  }

  Future<String?> _performRefresh() async {
    final refreshToken = await _storage.readRefreshToken();
    if (refreshToken == null) return null;

    try {
      // A bare Dio instance, so this call cannot recurse through the
      // interceptor that triggered it.
      final client = Dio(BaseOptions(baseUrl: Env.apiBaseUrl));
      final response = await client.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken, 'client': 'mobile'},
      );

      final data = response.data?['data'] as Map<String, dynamic>?;
      final newAccessToken = data?['accessToken'] as String?;
      final newRefreshToken = data?['refreshToken'] as String?;

      if (newAccessToken == null) return null;

      _accessToken = newAccessToken;
      if (newRefreshToken != null) {
        await _storage.writeRefreshToken(newRefreshToken);
      }
      return newAccessToken;
    } catch (_) {
      // The refresh token is dead (expired, revoked, or reuse detected).
      await _storage.clearAll();
      _accessToken = null;
      return null;
    }
  }

  // --- Typed helpers --------------------------------------------------------
  // The API wraps every payload in `data`, with list endpoints adding `meta`.

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async {
    final response = await _dio.get<Map<String, dynamic>>(path, queryParameters: query);
    return _unwrap(response);
  }

  Future<List<dynamic>> getList(String path, {Map<String, dynamic>? query}) async {
    final response = await _dio.get<Map<String, dynamic>>(path, queryParameters: query);
    return (response.data?['data'] as List<dynamic>?) ?? const [];
  }

  Future<PagedResponse> getPaged(String path, {Map<String, dynamic>? query}) async {
    final response = await _dio.get<Map<String, dynamic>>(path, queryParameters: query);
    return PagedResponse(
      items: (response.data?['data'] as List<dynamic>?) ?? const [],
      meta: (response.data?['meta'] as Map<String, dynamic>?) ?? const {},
    );
  }

  Future<Map<String, dynamic>> post(String path, {Object? body}) async {
    final response = await _dio.post<Map<String, dynamic>>(path, data: body);
    return _unwrap(response);
  }

  Future<Map<String, dynamic>> patch(String path, {Object? body}) async {
    final response = await _dio.patch<Map<String, dynamic>>(path, data: body);
    return _unwrap(response);
  }

  Future<void> delete(String path) => _dio.delete<dynamic>(path);

  Map<String, dynamic> _unwrap(Response<Map<String, dynamic>> response) {
    final data = response.data?['data'];
    if (data is Map<String, dynamic>) return data;
    return response.data ?? const {};
  }
}

class PagedResponse {
  const PagedResponse({required this.items, required this.meta});

  final List<dynamic> items;
  final Map<String, dynamic> meta;

  int get page => (meta['page'] as num?)?.toInt() ?? 1;
  int get totalPages => (meta['totalPages'] as num?)?.toInt() ?? 1;
  int get totalItems => (meta['totalItems'] as num?)?.toInt() ?? items.length;
  bool get hasNextPage => meta['hasNextPage'] as bool? ?? false;
}
