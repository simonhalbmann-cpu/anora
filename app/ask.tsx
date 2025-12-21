import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { getAnswer } from "../src/services/localAI";

export default function Ask() {
  const [q, setQ] = useState("");
  const [a, setA] = useState("");

  async function ask() {
    const ans = await getAnswer(q);
    setA(ans);
  }

  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: "#0b0b14" }}>
      <Text
        style={{
          color: "#7ef9ff",
          fontSize: 22,
          fontWeight: "800",
          marginBottom: 8,
        }}
      >
        Ask (lokaler Demo-Modus)
      </Text>

      <Text
        style={{
          color: "#9aa0b4",
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        Dieser Bildschirm nutzt einen kleinen Offline-Speicher nur auf diesem
        Gerät. Die Fragen und Antworten haben{" "}
        <Text style={{ fontWeight: "700", color: "#cfe8ff" }}>
          nichts mit dem echten Anora-Brain (Firestore / anoraChat)
        </Text>{" "}
        zu tun.
      </Text>

      <TextInput
        placeholder="z.B. Wer hat mir damals den Zaun gebaut?"
        placeholderTextColor="#6b6b80"
        value={q}
        onChangeText={setQ}
        style={{
          borderWidth: 1,
          borderColor: "#1f9cff",
          padding: 12,
          borderRadius: 10,
          color: "white",
          marginBottom: 12,
        }}
      />

      <Pressable
        onPress={ask}
        style={{ backgroundColor: "#1f9cff", padding: 14, borderRadius: 12 }}
      >
        <Text
          style={{ color: "white", fontWeight: "700", textAlign: "center" }}
        >
          Fragen (offline)
        </Text>
      </Pressable>

      {a ? (
        <View
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 12,
            backgroundColor: "#121225",
            borderWidth: 1,
            borderColor: "#2a2a40",
          }}
        >
          <Text style={{ color: "#cfe8ff", fontSize: 16 }}>{a}</Text>
        </View>
      ) : null}
    </View>
  );
}