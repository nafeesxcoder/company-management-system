import 'package:flutter/material.dart';

/// Material 3 theme matching the web client.
///
/// The seed colour is the same deep sea green the web app uses, so the brand
/// colour and the semantic "money received" remain the same thing on both
/// surfaces. Figures use a serif with tabular numerals so a column of amounts
/// aligns on the decimal.
class AppTheme {
  const AppTheme._();

  static const Color _seed = Color(0xFF1F6F5C);
  static const Color gainLight = Color(0xFF1F6F5C);
  static const Color lossLight = Color(0xFFA33A2E);
  static const Color pendingLight = Color(0xFFA4700F);

  static const Color gainDark = Color(0xFF4FB79B);
  static const Color lossDark = Color(0xFFE0796B);
  static const Color pendingDark = Color(0xFFD9A441);

  /// Tabular figures: every digit the same width, so amounts line up.
  static const List<FontFeature> _figureFeatures = [
    FontFeature.tabularFigures(),
    FontFeature.liningFigures(),
  ];

  static TextStyle figureStyle({
    required double size,
    FontWeight weight = FontWeight.w600,
    Color? color,
  }) =>
      TextStyle(
        fontFamily: 'serif',
        fontSize: size,
        fontWeight: weight,
        color: color,
        fontFeatures: _figureFeatures,
        letterSpacing: -0.5,
      );

  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(seedColor: _seed, brightness: brightness);
    final isDark = brightness == Brightness.dark;

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: isDark ? const Color(0xFF11181F) : const Color(0xFFFBFBF9),
      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 1,
        backgroundColor: isDark ? const Color(0xFF11181F) : const Color(0xFFFBFBF9),
        foregroundColor: scheme.onSurface,
        titleTextStyle: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: scheme.onSurface,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        color: isDark ? const Color(0xFF17202A) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.5)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? const Color(0xFF1C2630) : Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          // 48dp minimum: a comfortable touch target.
          minimumSize: const Size(0, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 68,
        elevation: 0,
        backgroundColor: isDark ? const Color(0xFF17202A) : Colors.white,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      ),
      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant.withValues(alpha: 0.6),
        thickness: 1,
        space: 1,
      ),
      chipTheme: ChipThemeData(
        side: BorderSide(color: scheme.outlineVariant),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }

  static Color gain(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? gainDark : gainLight;

  static Color loss(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? lossDark : lossLight;

  static Color pending(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? pendingDark : pendingLight;
}