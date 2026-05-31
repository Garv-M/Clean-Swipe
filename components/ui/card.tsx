import { Colors, Shadows, Spacing } from '@/constants/theme';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, style }: CardProps) {
  return (
    <View style={[styles.card, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: Spacing.cardRadius,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.cardPadding,
    ...Shadows.cardShadow,
  },
});
