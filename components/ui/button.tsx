import { Colors, Spacing, Shadows } from '@/constants/theme';
import { StyleSheet, Text, TouchableOpacity, type TouchableOpacityProps, type ViewStyle } from 'react-native';

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'frosted';

interface ButtonProps extends TouchableOpacityProps {
  variant?: Variant;
  label: string;
  color?: string;
}

export function Button({ variant = 'primary', label, disabled, style, color, ...rest }: ButtonProps) {
  const frostedStyle: ViewStyle | undefined =
    variant === 'frosted' && color
      ? {
          backgroundColor: `${color}1F`, // ~0.12 opacity
          borderColor: `${color}4D`,     // ~0.3 opacity
        }
      : undefined;

  return (
    <TouchableOpacity
      style={[
        styles.base,
        styles[variant],
        frostedStyle,
        variant === 'primary' && Shadows.primaryGlow,
        variant === 'destructive' && Shadows.destructiveGlow,
        disabled && styles.disabled,
        style,
      ]}
      activeOpacity={0.75}
      disabled={disabled}
      {...rest}>
      <Text style={[styles.label, labelStyles[variant], color ? { color } : undefined]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    height: Spacing.buttonHeight,
    borderRadius: Spacing.buttonRadius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primary: {
    backgroundColor: Colors.primary,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  destructive: {
    backgroundColor: Colors.destructive,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  frosted: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
});

const labelStyles = StyleSheet.create({
  primary: { color: '#FFFFFF' },
  secondary: { color: Colors.primary },
  destructive: { color: '#FFFFFF' },
  ghost: { color: Colors.textSecondary },
  frosted: { color: Colors.textPrimary },
});
