import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { teachAnswer } from "../src/services/localAI";

export default function Teach() {
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [msg, setMsg] = useState("");

  async function teach() {
    await teachAnswer(q, a);
    setMsg("Gespeichert. Anora hat es auf DIESEM Gerät gelernt (Offline-Demo).");
    setQ("");
    setA("");
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
        Teach (lokaler Demo-Modus)
      </Text>

      <Text
        style={{
          color: "#9aa0b4",
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        Hier bringst du einer{" "}
        <Text style={{ fontWeight: "700", color: "#cfe8ff" }}>
          rein lokalen
        </Text>{" "}
        Anora-Variante etwas bei. Das landet{" "}
        <Text style={{ fontWeight: "700", color: "#cfe8ff" }}>
          nur im AsyncStorage
        </Text>{" "}
        auf diesem Gerät, nicht im echten Brain in Firestore.
      </Text>

      <TextInput
        placeholder="Frage / Erinnerung"
        placeholderTextColor="#6b6b80"
        value={q}
        onChangeText={setQ}
        style={{
          borderWidth: 1,
          borderColor: "#1f9cff",
          padding: 12,
          borderRadius: 10,
          color: "white",
          marginBottom: 10,
        }}
      />

      <TextInput
        placeholder="Antwort / Info"
        placeholderTextColor="#6b6b80"
        value={a}
        onChangeText={setA}
        multiline
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
        onPress={teach}
        style={{ backgroundColor: "#20d6b5", padding: 14, borderRadius: 12 }}
      >
        <Text
          style={{ color: "white", fontWeight: "700", textAlign: "center" }}
        >
          Lernen (offline)
        </Text>
      </Pressable>

      {msg ? (
        <Text style={{ color: "#9aa0b4", marginTop: 12 }}>{msg}</Text>
      ) : null}
    </View>
  );
}