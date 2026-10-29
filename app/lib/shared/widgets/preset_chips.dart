import 'package:flutter/material.dart';

/// The date-range presets every financial screen filters by.
///
/// The values are the API's `preset` query parameter verbatim — if a value here
/// does not match `DATE_PRESETS` on the server the request is rejected, so this
/// list is the single place the app spells them.
const List<(String, String)> kDatePresets = [
  ('today', 'Today'),
  ('last7days', '7 days'),
  ('thisMonth', 'This month'),
  ('lastMonth', 'Last month'),
  ('thisYear', 'This year'),
  ('allTime', 'All time'),
];

/// Horizontal row of range chips, shared by Overview and Reports so the two
/// screens always offer the same ranges.
class PresetChips extends StatelessWidget {
  const PresetChips({
    super.key,
    required this.selected,
    required this.onSelected,
    this.presets = kDatePresets,
  });

  final List<(String, String)> presets;
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: presets.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final (value, label) = presets[index];
          return ChoiceChip(
            label: Text(label),
            selected: selected == value,
            onSelected: (_) => onSelected(value),
          );
        },
      ),
    );
  }
}
