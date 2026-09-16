import { Keyboard, TouchableWithoutFeedback, View } from 'react-native';
import type { ViewStyle } from 'react-native';

export default function DismissKeyboardView({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={[{ flex: 1 }, ...(Array.isArray(style) ? style : style ? [style] : [])]}>
        {children}
      </View>
    </TouchableWithoutFeedback>
  );
}
