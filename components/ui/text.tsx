import { Colors } from '@/constants/theme';
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
}

export function Text({ variant = 'body', children, style }: TextProps) {
  return (
    <RNText style={[styles[variant], style]} numberOfLines={0}>
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  hero: {
    fontSize: 36,
    fontWeight: 'bold',
    color: Colors.textPrimary,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.textPrimary,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  body: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.textPrimary,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  caption: {
    fontSize: 11,
    fontWeight: '400',
    color: Colors.textTertiary,
  },
});
