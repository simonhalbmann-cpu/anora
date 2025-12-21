import React from "react";
import { Pressable, Text } from "react-native";
import { colors } from "../theme/colors";

export default function NeonButton({
  title,
  onPress,
  variant = "blue",
  style = {},
}: {
  title: string;
  onPress: () => void;
  variant?: "blue" | "green";
  style?: any;
}) {
  const bg = variant === "green" ? colors.neonGreen : colors.neonBlue;

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: bg,
        padding: 14,
        borderRadius: 12,
        alignItems: "center",
        width: "100%",
        shadowOpacity: 0.25,
        ...style,
      }}
    >
      <Text style={{ color: "white", fontWeight: "700", fontSize: 16 }}>
        {title}
      </Text>
    </Pressable>
  );
}
