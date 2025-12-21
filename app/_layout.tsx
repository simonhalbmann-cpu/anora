import { Stack } from "expo-router";
import React from "react";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false, // kein weißer Header mehr
        animation: "fade",
        contentStyle: { backgroundColor: "#0b0b14" },
      }}
    />
  );
}