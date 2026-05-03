import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useSettingsStore } from '@/store/settings';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

export default function HomeScreen() {
  const onboarded = useSettingsStore((s) => s.onboarded);

  // Declarative redirect: if not onboarded, immediately route away
  if (!onboarded) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <View style={styles.container}>
      <Text variant="title">Clean Swipe</Text>
      <Card style={styles.card}>
        <Text variant="body">Your sessions will appear here</Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 20,
    paddingTop: 60,
  },
  card: {
    marginTop: 16,
  },
});