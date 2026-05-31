import { Colors } from '@/constants/theme';
import { scaledFont } from '@/utils/responsive';
import {
  Text as RNText,
  StyleSheet,
  type StyleProp,
  type TextStyle,
} from 'react-native';

type Variant = 'hero' | 'title' | 'heading' | 'body' | 'label' | 'caption';

interface TextProps {
  variant?: Variant;
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

export function Text({ variant = 'body', children, style, numberOfLines }: TextProps) {
  return (
    <RNText style={[styles[variant], style]} numberOfLines={numberOfLines ?? 0}>
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  hero: {
    fontSize: scaledFont(40),
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -1,
  },
  title: {
    fontSize: scaledFont(22),
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  heading: {
    fontSize: scaledFont(17),
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  body: {
    fontSize: scaledFont(14),
    fontWeight: '400',
    color: Colors.textPrimary,
  },
  label: {
    fontSize: scaledFont(11),
    fontWeight: '600',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  caption: {
    fontSize: scaledFont(10),
    fontWeight: '400',
    color: Colors.textTertiary,
    letterSpacing: 0.8,
  },
});
