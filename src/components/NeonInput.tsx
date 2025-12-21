import React from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { colors } from "../theme/colors";

export default function NeonInput(props: any) {
  return (
    <View style={styles.container}>
      <TextInput
        {...props}
        placeholderTextColor={colors.textDim}
        style={[styles.input, props.style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 2,
    borderColor: colors.neonBlue,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  input: {
    height: 48,
    fontSize: 16,
    color: colors.neonCyan, // <-- SICHTBARE TEXTFARBE
  },
});
