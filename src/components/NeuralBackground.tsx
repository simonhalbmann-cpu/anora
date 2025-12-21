import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { colors } from "../theme/colors";

type BlobAnim = {
  translateX: Animated.Value;
  translateY: Animated.Value;
  scale: Animated.Value;
  opacity: Animated.Value;
};

export default function NeuralBackground() {
  const { width, height } = useWindowDimensions();

  // drei „Lichtblasen“
  const blobs = useRef<BlobAnim[]>(
    [0, 1, 2].map(() => ({
      translateX: new Animated.Value(0),
      translateY: new Animated.Value(0),
      scale: new Animated.Value(1),
      opacity: new Animated.Value(0.3),
    }))
  ).current;

  useEffect(() => {
    blobs.forEach((blob, idx) => {
      const offset = idx * 600; // Startversatz

      const loopAnim = () =>
        Animated.parallel([
          Animated.loop(
            Animated.sequence([
              Animated.delay(offset),
              Animated.timing(blob.translateX, {
                toValue: 30,
                duration: 6000,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(blob.translateX, {
                toValue: -30,
                duration: 6000,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
              }),
            ])
          ),
          Animated.loop(
            Animated.sequence([
              Animated.delay(offset / 2),
              Animated.timing(blob.translateY, {
                toValue: 20,
                duration: 7000,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(blob.translateY, {
                toValue: -20,
                duration: 7000,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
              }),
            ])
          ),
          Animated.loop(
            Animated.sequence([
              Animated.timing(blob.scale, {
                toValue: 1.2,
                duration: 5000,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(blob.scale, {
                toValue: 0.9,
                duration: 5000,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
              }),
            ])
          ),
          Animated.loop(
            Animated.sequence([
              Animated.timing(blob.opacity, {
                toValue: 0.45,
                duration: 4000,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(blob.opacity, {
                toValue: 0.2,
                duration: 4000,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
              }),
            ])
          ),
        ]);

      loopAnim();
    });
  }, [blobs]);

  const size = Math.max(width, height) * 0.8;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {blobs.map((blob, idx) => {
        // leicht verschiedene Startpositionen und Farben
        const baseX = idx === 0 ? width * 0.2 : idx === 1 ? width * 0.8 : width * 0.5;
        const baseY = idx === 0 ? height * 0.2 : idx === 1 ? height * 0.65 : height * 0.45;

        const tint =
          idx === 0
            ? colors.neonCyan
            : idx === 1
            ? colors.neonBlue
            : "#a3b4ff";

        return (
          <Animated.View
            key={idx}
            style={[
              styles.blob,
              {
                width: size,
                height: size,
                left: baseX - size / 2,
                top: baseY - size / 2,
                backgroundColor: tint,
                opacity: blob.opacity,
                transform: [
                  { translateX: blob.translateX },
                  { translateY: blob.translateY },
                  { scale: blob.scale },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  blob: {
    position: "absolute",
    borderRadius: 9999,
    shadowColor: colors.neonCyan,
    shadowOpacity: 0.8,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
  },
});
