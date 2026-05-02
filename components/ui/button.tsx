import { Colors } from '@/constants/theme';
import { StyleSheet, Text, TouchableOpacity, type TouchableOpacityProps } from 'react-native';

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost';

interface ButtonProps extends TouchableOpacityProps {
  variant?: Variant;
  label: string;
}

export function Button({ variant = 'primary', label, disabled, style, ...rest }: ButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.base, styles[variant], disabled && styles.disabled, style]}
      activeOpacity={0.75}
      disabled={disabled}
      {...rest}>
      <Text style={[styles.label, labelStyles[variant]]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    borderRadius: 14,
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
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
  },
});

const labelStyles = StyleSheet.create({
  primary: { color: '#FFFFFF' },
  secondary: { color: Colors.primary },
  destructive: { color: '#FFFFFF' },
  ghost: { color: Colors.textSecondary },
});
