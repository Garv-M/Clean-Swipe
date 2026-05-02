import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { StyleSheet, View } from 'react-native';

export default function BinScreen() {
  return (
    <View style={styles.container}>
      <Text variant="title">Bin</Text>
      <Text variant="body" style={styles.sub}>
        Deleted photos will appear here
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sub: {
    color: Colors.textSecondary,
  },
});
