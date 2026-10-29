import 'package:dio/dio.dart';

/// A failure the UI can show to a person.
///
/// Every error reaching a screen is one of these, so no screen ever renders a
/// raw Dio message or a stack trace. The API's own error envelope
/// (`{ error: { code, message, details } }`) is the preferred source, because
/// it is already written for a reader.
class ApiException implements Exception {
  const ApiException({
    required this.message,
    required this.code,
    required this.statusCode,
    this.details,
    this.requestId,
  });

  final String message;
  final String code;
  final int statusCode;
  final Object? details;
  final String? requestId;

  factory ApiException.fromResponse(Response<dynamic> response) {
    final body = response.data;
    final error = body is Map<String, dynamic> ? body['error'] as Map<String, dynamic>? : null;

    return ApiException(
      message: error?['message'] as String? ?? 'Something went wrong.',
      code: error?['code'] as String? ?? 'UNKNOWN',
      statusCode: response.statusCode ?? 0,
      details: error?['details'],
      requestId: error?['requestId'] as String?,
    );
  }

  factory ApiException.fromDioException(DioException error) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.transformTimeout:
        return const ApiException(
          message: 'The server took too long to respond. Check your connection and try again.',
          code: 'TIMEOUT',
          statusCode: 408,
        );
      case DioExceptionType.connectionError:
        return const ApiException(
          message: 'Could not reach the server. Check your connection and try again.',
          code: 'NETWORK_ERROR',
          statusCode: 0,
        );
      case DioExceptionType.badCertificate:
        return const ApiException(
          message: 'The server certificate could not be verified.',
          code: 'BAD_CERTIFICATE',
          statusCode: 0,
        );
      case DioExceptionType.cancel:
        return const ApiException(message: 'Request canceled.', code: 'CANCELED', statusCode: 0);
      case DioExceptionType.badResponse:
        if (error.response != null) return ApiException.fromResponse(error.response!);
        return const ApiException(
          message: 'The server returned an unexpected response.',
          code: 'BAD_RESPONSE',
          statusCode: 0,
        );
      case DioExceptionType.unknown:
        return const ApiException(
          message: 'Something went wrong. Please try again.',
          code: 'UNKNOWN',
          statusCode: 0,
        );
    }
  }

  bool get isUnauthorized => statusCode == 401;
  bool get isForbidden => statusCode == 403;
  bool get isNotFound => statusCode == 404;
  bool get isValidation => statusCode == 400 || statusCode == 422;

  /// Field-level messages from the API's validation errors, keyed by field.
  Map<String, String> get fieldErrors {
    final list = details;
    if (list is! List) return const {};

    final result = <String, String>{};
    for (final item in list) {
      if (item is Map && item['field'] is String && item['message'] is String) {
        result[item['field'] as String] = item['message'] as String;
      }
    }
    return result;
  }

  /// Turns any thrown object into something displayable.
  static ApiException from(Object error) {
    if (error is ApiException) return error;
    if (error is DioException) {
      if (error.error is ApiException) return error.error! as ApiException;
      return ApiException.fromDioException(error);
    }
    return const ApiException(
      message: 'Something went wrong. Please try again.',
      code: 'UNKNOWN',
      statusCode: 0,
    );
  }

  @override
  String toString() => 'ApiException($code, $statusCode): $message';
}
